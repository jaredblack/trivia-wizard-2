use crate::{
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
    WebSocketStream, accept_async,
    tungstenite::{Error, Message, Result},
};

pub type Tx = mpsc::UnboundedSender<Message>;
pub type Rx = mpsc::UnboundedReceiver<Message>;

struct GameState {
    games: Mutex<HashMap<String, Game>>,
    timer: Mutex<ShutdownTimer>,
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
            Error::ConnectionClosed | Error::Protocol(_) | Error::Utf8 => (),
            err => error!("Error processing connection: {err}"),
        }
    }
    info!("accept connection");

    for game in game_state.games.lock().await.values() {
        if game.host_tx.is_some() {
            return;
        }
    }
    // If no hosts remain connected, we're shuttin' down the server.
    info!("All hosts disconnected.");
    game_state.timer.lock().await.start_timer().await;
}

async fn handle_connection(
    peer: SocketAddr,
    stream: TcpStream,
    game_state: Arc<GameState>,
) -> Result<()> {
    let mut ws_stream = accept_async(stream).await.expect("Failed to accept");

    if let Some(msg) = ws_stream.next().await {
        let msg = msg?;
        if let Ok(text) = msg.to_text() {
            info!("65 Received message: {text}");
            match serde_json::from_str::<ClientMessage>(text) {
                Ok(client_message) => {
                    info!("Parsed message: {client_message:?}");
                    match client_message {
                        ClientMessage::Host(action) => {
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
    info!("exiting handel connection");

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
    if let Some(existing_game) = games_map.get_mut(&game_code) {
        if existing_game.host_tx.is_none() {
            info!("Host reclaiming existing game: {game_code}");
            existing_game.set_host_tx(tx.clone());
            drop(games_map);
            let msg = ServerMessage::Host(HostServerMessage::GameCreated {
                game_code: game_code.clone(),
            });
            send_msg(&tx, msg);
            handle_host(ws_stream, game_state, rx, game_code).await;
            info!("exiting create game (reclaimed)");
            return;
        }
    }

    games_map.insert(game_code.clone(), Game::new(game_code.clone(), tx.clone()));
    drop(games_map);
    info!("Game created: {game_code}");
    let msg = ServerMessage::Host(HostServerMessage::GameCreated {
        game_code: game_code.clone(),
    });
    send_msg(&tx, msg);
    handle_host(ws_stream, game_state, rx, game_code).await;
    info!("exiting create game");
}

async fn handle_host(
    ws_stream: WebSocketStream<TcpStream>,
    game_state: Arc<GameState>,
    mut rx: Rx,
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
                info!("151 Received message: {text}");
                let games_map = game_state2.games.lock().await;
                if let Some(game) = games_map.get(&game_code2) {
                    match serde_json::from_str::<ClientMessage>(text) {
                        Ok(msg) => {
                            if let ClientMessage::Host(action) = msg {
                                match action {
                                    HostAction::ScoreAnswer {
                                        team_name,
                                        answer: _,
                                    } => {
                                        let msg =
                                            ServerMessage::Host(HostServerMessage::ScoreUpdate {
                                                team_name: team_name.clone(),
                                                score: 1,
                                            });
                                        send_msg(game.host_tx.as_ref().unwrap(), msg);
                                    }
                                    HostAction::CreateGame => {
                                        let msg = ServerMessage::Error(
                                            "Game already created".to_string(),
                                        );
                                        send_msg(game.host_tx.as_ref().unwrap(), msg);
                                    }
                                    HostAction::ReclaimGame { game_code: _ } => {
                                        let msg =
                                            ServerMessage::Error("Already in a game".to_string());
                                        send_msg(game.host_tx.as_ref().unwrap(), msg);
                                    }
                                }
                            } else {
                                let msg = ServerMessage::Error(
                                    "Unexpected message type: expected Host message".to_string(),
                                );
                                send_msg(game.host_tx.as_ref().unwrap(), msg);
                            }
                        }
                        Err(e) => {
                            error!("Failed to parse message: {text}");
                            error!("Error: {e}");
                            let msg = ServerMessage::Error(
                                "Server error: Failed to parse message".to_string(),
                            );
                            send_msg(game.host_tx.as_ref().unwrap(), msg);
                        }
                    }
                }
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

    let game_state = game_state.clone();

    let read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            if let Ok(text) = msg.to_text() {
                info!("Received message: {text}");
                let games_map = game_state.games.lock().await;
                if let Some(game) = games_map.get(&game_code) {
                    let team_tx = game.teams_tx.get(&team_name).unwrap();
                    match serde_json::from_str::<ClientMessage>(text) {
                        Ok(msg) => {
                            if let ClientMessage::Team(action) = msg {
                                match action {
                                    TeamAction::SubmitAnswer { team_name, answer } => {
                                        if let Some(host_tx) = game.host_tx.as_ref() {
                                            let team_msg = ServerMessage::Team(
                                                TeamServerMessage::AnswerSubmitted,
                                            );
                                            send_msg(team_tx, team_msg);
                                            let host_msg =
                                                ServerMessage::Host(HostServerMessage::NewAnswer {
                                                    answer: answer.clone(),
                                                    team_name: team_name.clone(),
                                                });
                                            send_msg(host_tx, host_msg);
                                        } else {
                                            let msg = ServerMessage::Error(
                                                "Host is not connected".to_string(),
                                            );
                                            send_msg(team_tx, msg);
                                        }
                                    }
                                    TeamAction::JoinGame { .. } => {
                                        let msg =
                                            ServerMessage::Error("Game already joined".to_string());
                                        send_msg(team_tx, msg);
                                    }
                                }
                            } else {
                                let msg = ServerMessage::Error(
                                    "Unexpected message type: expected Team message".to_string(),
                                );
                                send_msg(team_tx, msg);
                            }
                        }
                        Err(e) => {
                            error!("Failed to parse message: {text}");
                            error!("Error: {e}");
                            let msg = ServerMessage::Error(
                                "Server error: Failed to parse message".to_string(),
                            );
                            send_msg(team_tx, msg);
                        }
                    }
                }
            }
        }
    });
    tokio::select! {
        _ = write_task => {},
        _ = read_task => {},
    }
}

pub async fn start_ws_server(listener: TcpListener, timer: ShutdownTimer) {
    let addr = listener.local_addr().expect("Failed to get local address");
    info!("Listening on: {addr}");

    let game_state: Arc<GameState> = Arc::new(GameState {
        games: Mutex::new(HashMap::new()),
        timer: Mutex::new(timer),
    });

    while let Ok((stream, _)) = listener.accept().await {
        let peer = stream
            .peer_addr()
            .expect("connected streams should have a peer address");
        info!("Peer address: {peer}");

        tokio::spawn(accept_connection(peer, stream, game_state.clone()));
    }
}
