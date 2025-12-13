use crate::{
    auth::{AuthResult, JwtValidator},
    infra,
    model::{
        client_message::{ClientMessage, HostAction, TeamAction},
        game::Game,
        server_message::{HostServerMessage, ServerMessage, TeamServerMessage, send_msg},
    },
    timer::ShutdownTimer,
};
use futures_util::{SinkExt, StreamExt};
use log::*;
use rand::Rng;
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Mutex, mpsc},
};
use tokio_tungstenite::{
    WebSocketStream, accept_hdr_async,
    tungstenite::{
        Error, Message, Result,
        handshake::server::{Request, Response},
    },
};

pub type Tx = mpsc::UnboundedSender<Message>;
pub type Rx = mpsc::UnboundedReceiver<Message>;

struct GameState {
    games: Mutex<HashMap<String, Game>>,
    timer: Mutex<ShutdownTimer>,
    validator: Arc<dyn JwtValidator>,
}

fn generate_code() -> String {
    rand::rng()
        .sample_iter(&rand::distr::Alphabetic)
        .take(4)
        .map(|c| (c as char).to_ascii_uppercase())
        .collect()
}

async fn accept_connection(peer: SocketAddr, stream: TcpStream, game_state: Arc<GameState>) {
    if let Err(e) = handle_connection(peer, stream, game_state.clone()).await {
        match e {
            Error::ConnectionClosed | Error::Protocol(_) | Error::Utf8(_) => (),
            err => error!("Error processing connection: {err}"),
        }
    }

    for game in game_state.games.lock().await.values() {
        if game.host_tx.is_some() {
            return;
        }
    }
    // If no hosts remain connected, we're shuttin' down the server.
    info!("All hosts disconnected.");
    game_state.timer.lock().await.start_timer().await;
}

fn extract_token_from_request(request: &Request) -> Option<String> {
    let uri = request.uri();
    let query = uri.query()?;
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=')
            && key == "token"
        {
            return Some(value.to_string());
        }
    }
    None
}

async fn handle_connection(
    _peer: SocketAddr,
    stream: TcpStream,
    game_state: Arc<GameState>,
) -> Result<()> {
    // In local dev mode (not tests), skip auth entirely and treat all connections as authenticated hosts
    let skip_auth = infra::is_local() && !infra::is_test();

    let mut auth_result: Option<AuthResult> = if skip_auth {
        info!("Local dev mode: skipping auth, treating connection as authenticated host");
        Some(AuthResult {
            user_id: "local-dev".to_string(),
            is_host: true,
        })
    } else {
        None
    };

    let validator = game_state.validator.clone();

    let callback = |request: &Request, response: Response| {
        // Only validate tokens when not skipping auth
        if !skip_auth
            && let Some(token) = extract_token_from_request(request) {
                match validator.validate(&token) {
                    Ok(result) => {
                        info!("Token validated for user: {}", result.user_id);
                        auth_result = Some(result);
                    }
                    Err(e) => {
                        warn!("Token validation failed: {}", e);
                    }
                }
            }
        Ok(response)
    };

    let mut ws_stream = accept_hdr_async(stream, callback)
        .await
        .expect("Failed to accept");

    if let Some(msg) = ws_stream.next().await {
        let msg = msg?;
        if let Ok(text) = msg.to_text() {
            info!("Received message: {text}");
            match serde_json::from_str::<ClientMessage>(text) {
                Ok(client_message) => {
                    info!("Parsed message: {client_message:?}");
                    match client_message {
                        ClientMessage::Host(action) => {
                            // Host actions require authentication
                            match &auth_result {
                                Some(auth) if auth.is_host => {
                                    if let HostAction::CreateGame = action {
                                        create_game(game_state, ws_stream, generate_code()).await;
                                    } else if let HostAction::ReclaimGame { game_code } = action {
                                        create_game(game_state, ws_stream, game_code).await;
                                    } else {
                                        error!(
                                            "Expected CreateGame from new Host connection, instead got: {action:?}"
                                        );
                                        let error_message = ServerMessage::Error(
                                            "First action must be CreateGame".to_string(),
                                        );
                                        let msg = serde_json::to_string(&error_message).unwrap();
                                        ws_stream.send(Message::text(msg)).await?;
                                    }
                                }
                                Some(_) => {
                                    warn!("User authenticated but not in Trivia-Hosts group");
                                    let error_message = ServerMessage::Error(
                                        "User is not authorized as a host".to_string(),
                                    );
                                    let msg = serde_json::to_string(&error_message).unwrap();
                                    ws_stream.send(Message::text(msg)).await?;
                                }
                                None => {
                                    warn!("Host action attempted without authentication");
                                    let error_message = ServerMessage::Error(
                                        "Authentication required for host actions".to_string(),
                                    );
                                    let msg = serde_json::to_string(&error_message).unwrap();
                                    ws_stream.send(Message::text(msg)).await?;
                                }
                            }
                        }
                        ClientMessage::Team(action) => {
                            info!("Team message: {action:?}");
                            if let TeamAction::JoinGame {
                                game_code,
                                team_name,
                            } = action
                            {
                                join_game(game_state, ws_stream, game_code, team_name).await;
                            } else {
                                error!(
                                    "Expected JoinGame from new Team connection, instead got: {action:?}"
                                );
                                let error_message = ServerMessage::Error(
                                    "First action must be JoinGame".to_string(),
                                );
                                let msg = serde_json::to_string(&error_message).unwrap();
                                ws_stream.send(Message::text(msg)).await?;
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to parse message: {e}");
                    let error_message = ServerMessage::Error(format!("Invalid JSON: {e}"));
                    let msg = serde_json::to_string(&error_message).unwrap();
                    ws_stream.send(Message::text(msg)).await?;
                }
            }
        }
    }
    Ok(())
}

async fn create_game(
    game_state: Arc<GameState>,
    ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
) {
    game_state
        .timer
        .lock()
        .await
        .cancel_timer()
        .await
        .unwrap_or_else(|e| error!("{e:?}"));

    let (tx, rx) = mpsc::unbounded_channel::<Message>();
    let mut games_map = game_state.games.lock().await;

    // Check if game exists and can be reclaimed (host disconnected)
    if let Some(existing_game) = games_map.get_mut(&game_code)
        && existing_game.host_tx.is_none()
    {
        info!("Host reclaiming existing game: {game_code}");
        existing_game.set_host_tx(tx.clone());
        drop(games_map);
        let msg = ServerMessage::Host(HostServerMessage::GameCreated {
            game_code: game_code.clone(),
        });
        send_msg(&tx, msg);
        handle_host(ws_stream, game_state, rx, tx, game_code).await;
        return;
    }

    games_map.insert(game_code.clone(), Game::new(game_code.clone(), tx.clone()));
    drop(games_map);
    info!("Game created: {game_code}");
    let msg = ServerMessage::Host(HostServerMessage::GameCreated {
        game_code: game_code.clone(),
    });
    send_msg(&tx, msg);
    handle_host(ws_stream, game_state, rx, tx, game_code).await;
}

fn process_host_action(action: HostAction) -> ServerMessage {
    match action {
        HostAction::ScoreAnswer {
            team_name,
            answer: _,
        } => ServerMessage::Host(HostServerMessage::ScoreUpdate {
            team_name,
            score: 1,
        }),
        HostAction::CreateGame => ServerMessage::Error("Game already created".to_string()),
        HostAction::ReclaimGame { game_code: _ } => {
            ServerMessage::Error("Already in a game".to_string())
        }
    }
}

async fn process_host_message(
    text: &str,
    game_state: &Arc<GameState>,
    game_code: &str,
    host_tx: &Tx,
) {
    let games_map = game_state.games.lock().await;
    if games_map.get(game_code).is_none() {
        error!("Game {game_code} not found while processing host message");
        return;
    }
    drop(games_map);

    let msg = match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::Host(action)) => process_host_action(action),
        Ok(_) => ServerMessage::Error("Unexpected message type: expected Host message".to_string()),
        Err(e) => {
            error!("Failed to parse message: {text}");
            error!("Error: {e}");
            ServerMessage::Error("Server error: Failed to parse message".to_string())
        }
    };

    send_msg(host_tx, msg);
}

async fn handle_host(
    ws_stream: WebSocketStream<TcpStream>,
    game_state: Arc<GameState>,
    mut rx: Rx,
    host_tx: Tx,
    game_code: String,
) {
    let (mut ws_write, mut ws_read) = ws_stream.split();

    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_write.send(msg).await.is_err() {
                break;
            }
        }
    });

    let game_state2 = game_state.clone();
    let game_code2 = game_code.clone();

    let read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            if let Ok(text) = msg.to_text() {
                if text.is_empty() {
                    log::warn!("Received empty message");
                    continue;
                }
                info!("Received message: {text}");
                process_host_message(text, &game_state2, &game_code2, &host_tx).await;
            }
        }
    });

    tokio::select! {
        _ = write_task => {},
        _ = read_task => {},
    }
    info!("Host disconnected, clearing host_tx");
    if let Some(game) = game_state.games.lock().await.get_mut(&game_code) {
        game.clear_host_tx();
    } else {
        error!("Game {game_code} not found in game_state when host disconnected");
    }
}

async fn join_game(
    game_state: Arc<GameState>,
    mut ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
    team_name: String,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Message>();
    let mut games_map = game_state.games.lock().await;
    if let Some(game) = games_map.get_mut(&game_code) {
        info!("Team {team_name} joined game {game_code}");
        game.add_team(team_name.clone(), tx.clone());
        drop(games_map);
        let msg = ServerMessage::Team(TeamServerMessage::GameJoined {
            game_code: game_code.clone(),
        });
        send_msg(&tx, msg);
        handle_team(ws_stream, game_state, rx, game_code, team_name).await;
    } else {
        drop(games_map);
        info!("Team {team_name} tried to join game {game_code}, but it doesn't exist");
        let error_message = ServerMessage::Error(format!("Game code {game_code} not found"));
        let msg = serde_json::to_string(&error_message).unwrap();
        let _ = ws_stream.send(Message::text(msg)).await;
    }
}

fn process_team_action(action: TeamAction, game: &Game, team_tx: &Tx) {
    match action {
        TeamAction::SubmitAnswer { team_name, answer } => {
            if let Some(host_tx) = game.host_tx.as_ref() {
                let team_msg = ServerMessage::Team(TeamServerMessage::AnswerSubmitted);
                send_msg(team_tx, team_msg);
                let host_msg =
                    ServerMessage::Host(HostServerMessage::NewAnswer { answer, team_name });
                send_msg(host_tx, host_msg);
            } else {
                let msg = ServerMessage::Error("Host is not connected".to_string());
                send_msg(team_tx, msg);
            }
        }
        TeamAction::JoinGame { .. } => {
            let msg = ServerMessage::Error("Game already joined".to_string());
            send_msg(team_tx, msg);
        }
    }
}

async fn process_team_message(
    text: &str,
    game_state: &Arc<GameState>,
    game_code: &str,
    team_name: &str,
) {
    let games_map = game_state.games.lock().await;
    let Some(game) = games_map.get(game_code) else {
        error!("Game {game_code} not found while processing team message from {team_name}");
        return;
    };
    let Some(team_tx) = game.teams_tx.get(team_name) else {
        error!("Team {team_name} not found in game {game_code} while processing message");
        return;
    };

    match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::Team(action)) => {
            process_team_action(action, game, team_tx);
        }
        Ok(_) => {
            let msg =
                ServerMessage::Error("Unexpected message type: expected Team message".to_string());
            send_msg(team_tx, msg);
        }
        Err(e) => {
            error!("Failed to parse message: {text}");
            error!("Error: {e}");
            let msg = ServerMessage::Error("Server error: Failed to parse message".to_string());
            send_msg(team_tx, msg);
        }
    }
}

async fn handle_team(
    ws_stream: WebSocketStream<TcpStream>,
    game_state: Arc<GameState>,
    mut rx: Rx,
    game_code: String,
    team_name: String,
) {
    let (mut ws_write, mut ws_read) = ws_stream.split();

    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_write.send(msg).await.is_err() {
                break;
            }
        }
    });

    let game_state2 = game_state.clone();
    let game_code2 = game_code.clone();
    let team_name2 = team_name.clone();

    let read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            if let Ok(text) = msg.to_text() {
                info!("Received message: {text}");
                process_team_message(text, &game_state2, &game_code2, &team_name2).await;
            }
        }
    });
    tokio::select! {
        _ = write_task => {},
        _ = read_task => {},
    }
}

pub async fn start_ws_server(
    listener: TcpListener,
    timer: ShutdownTimer,
    validator: Arc<dyn JwtValidator>,
) {
    let addr = listener.local_addr().expect("Failed to get local address");
    info!("Listening on: {addr}");

    let game_state: Arc<GameState> = Arc::new(GameState {
        games: Mutex::new(HashMap::new()),
        timer: Mutex::new(timer),
        validator,
    });

    while let Ok((stream, _)) = listener.accept().await {
        let peer = stream
            .peer_addr()
            .expect("connected streams should have a peer address");
        info!("Peer address: {peer}");

        tokio::spawn(accept_connection(peer, stream, game_state.clone()));
    }
}
