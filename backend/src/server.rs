use crate::{
    auth::{AuthResult, JwtValidator},
    game_timer::{handle_pause_timer, handle_reset_timer, handle_start_timer},
    infra,
    model::{
        client_message::{ClientMessage, HostAction, TeamAction},
        game::Game,
        server_message::{ServerMessage, send_msg},
        types::TeamColor,
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

pub struct AppState {
    pub games: Mutex<HashMap<String, Game>>,
    pub timer: Mutex<ShutdownTimer>,
    pub validator: Arc<dyn JwtValidator>,
}

fn generate_code() -> String {
    rand::rng()
        .sample_iter(&rand::distr::Alphabetic)
        .take(4)
        .map(|c| (c as char).to_ascii_uppercase())
        .collect()
}

async fn accept_connection(peer: SocketAddr, stream: TcpStream, app_state: Arc<AppState>) {
    if let Err(e) = handle_connection(peer, stream, app_state.clone()).await {
        match e {
            Error::ConnectionClosed | Error::Protocol(_) | Error::Utf8(_) => (),
            err => error!("Error processing connection: {err}"),
        }
    }

    for game in app_state.games.lock().await.values() {
        if game.host_tx.is_some() {
            return;
        }
    }
    // If no hosts remain connected, we're shuttin' down the server.
    info!("All hosts disconnected.");
    app_state.timer.lock().await.start_timer().await;
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
    app_state: Arc<AppState>,
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

    let validator = app_state.validator.clone();

    let callback = |request: &Request, response: Response| {
        // Only validate tokens when not skipping auth
        if !skip_auth && let Some(token) = extract_token_from_request(request) {
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
                                        create_game(app_state, ws_stream, generate_code()).await;
                                    } else if let HostAction::ReclaimGame { game_code } = action {
                                        create_game(app_state, ws_stream, game_code).await;
                                    } else {
                                        warn!(
                                            "Expected CreateGame from new Host connection, instead got: {action:?}"
                                        );
                                        let error_message =
                                            ServerMessage::error("First action must be CreateGame");
                                        let msg = serde_json::to_string(&error_message).unwrap();
                                        ws_stream.send(Message::text(msg)).await?;
                                    }
                                }
                                Some(_) => {
                                    warn!("User authenticated but not in Trivia-Hosts group");
                                    let error_message =
                                        ServerMessage::error("User is not authorized as a host");
                                    let msg = serde_json::to_string(&error_message).unwrap();
                                    ws_stream.send(Message::text(msg)).await?;
                                }
                                None => {
                                    info!("Host action attempted without authentication");
                                    let error_message = ServerMessage::error(
                                        "Authentication required for host actions",
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
                                color_hex,
                                team_members,
                            } = action
                            {
                                join_game(
                                    app_state,
                                    ws_stream,
                                    game_code,
                                    team_name,
                                    color_hex,
                                    team_members,
                                )
                                .await;
                            } else {
                                error!(
                                    "Expected JoinGame from new Team connection, instead got: {action:?}"
                                );
                                let error_message =
                                    ServerMessage::error("First action must be JoinGame");
                                let msg = serde_json::to_string(&error_message).unwrap();
                                ws_stream.send(Message::text(msg)).await?;
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to parse message: {e}");
                    let error_message = ServerMessage::error(format!("Invalid JSON: {e}"));
                    let msg = serde_json::to_string(&error_message).unwrap();
                    ws_stream.send(Message::text(msg)).await?;
                }
            }
        }
    }
    Ok(())
}

async fn create_game(
    app_state: Arc<AppState>,
    ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
) {
    app_state
        .timer
        .lock()
        .await
        .cancel_timer()
        .await
        .unwrap_or_else(|e| error!("{e:?}"));

    let (tx, rx) = mpsc::unbounded_channel::<Message>();
    let mut games_map = app_state.games.lock().await;

    // Check if game exists and can be reclaimed (host disconnected)
    if let Some(existing_game) = games_map.get_mut(&game_code)
        && existing_game.host_tx.is_none()
    {
        info!("Host reclaiming existing game: {game_code}");
        existing_game.set_host_tx(tx.clone());
        let msg = ServerMessage::GameState {
            state: existing_game.to_game_state(),
        };
        drop(games_map);
        send_msg(&tx, msg);
        handle_host(ws_stream, app_state, rx, tx, game_code).await;
        return;
    }

    let game = Game::new(game_code.clone(), tx.clone());
    let msg = ServerMessage::GameState {
        state: game.to_game_state(),
    };
    games_map.insert(game_code.clone(), game);
    drop(games_map);
    info!("Game created: {game_code}");
    send_msg(&tx, msg);
    handle_host(ws_stream, app_state, rx, tx, game_code).await;
}

/// Result of processing a host action: messages to send after releasing the lock
struct HostActionResult {
    host_msg: ServerMessage,
    team_msg: Option<(Tx, ServerMessage)>, // (cloned tx, message)
}

/// Process a host action that mutates game state.
/// The game reference must be held under a lock; this function does not await.
fn process_host_action(action: HostAction, game: &mut Game) -> HostActionResult {
    match action {
        HostAction::CreateGame => HostActionResult {
            host_msg: ServerMessage::error("Game already created"),
            team_msg: None,
        },
        HostAction::ReclaimGame { .. } => HostActionResult {
            host_msg: ServerMessage::error("Already in a game"),
            team_msg: None,
        },

        // Timer actions are handled specially in process_host_message
        HostAction::StartTimer { .. } | HostAction::PauseTimer | HostAction::ResetTimer => {
            unreachable!("Timer actions should be handled in process_host_message")
        }

        // Scoring actions
        HostAction::ScoreAnswer {
            question_number,
            team_name,
            score,
        } => {
            if game.score_answer(question_number, &team_name, score) {
                let host_msg = ServerMessage::GameState {
                    state: game.to_game_state(),
                };
                let team_msg = game.teams_tx.get(&team_name).cloned().and_then(|tx| {
                    game.to_team_game_state(&team_name)
                        .map(|state| (tx, ServerMessage::TeamGameState { state }))
                });
                HostActionResult { host_msg, team_msg }
            } else {
                HostActionResult {
                    host_msg: ServerMessage::error(format!(
                        "Failed to score answer for team '{}'",
                        team_name
                    )),
                    team_msg: None,
                }
            }
        }

        HostAction::ClearAnswerScore {
            question_number,
            team_name,
        } => {
            if game.clear_answer_score(question_number, &team_name) {
                let host_msg = ServerMessage::GameState {
                    state: game.to_game_state(),
                };
                let team_msg = game.teams_tx.get(&team_name).cloned().and_then(|tx| {
                    game.to_team_game_state(&team_name)
                        .map(|state| (tx, ServerMessage::TeamGameState { state }))
                });
                HostActionResult { host_msg, team_msg }
            } else {
                HostActionResult {
                    host_msg: ServerMessage::error(format!(
                        "Failed to clear answer score for team '{}'",
                        team_name
                    )),
                    team_msg: None,
                }
            }
        }

        HostAction::OverrideTeamScore {
            team_name,
            override_points,
        } => {
            if game.override_team_score(&team_name, override_points) {
                let host_msg = ServerMessage::GameState {
                    state: game.to_game_state(),
                };
                let team_msg = game.teams_tx.get(&team_name).cloned().and_then(|tx| {
                    game.to_team_game_state(&team_name)
                        .map(|state| (tx, ServerMessage::TeamGameState { state }))
                });
                HostActionResult { host_msg, team_msg }
            } else {
                HostActionResult {
                    host_msg: ServerMessage::error(format!("Team '{}' not found", team_name)),
                    team_msg: None,
                }
            }
        }
    }
}

async fn process_host_message(
    text: &str,
    app_state: &Arc<AppState>,
    game_code: &str,
    host_tx: &Tx,
) {
    // Parse message before acquiring lock
    let action = match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::Host(action)) => action,
        Ok(_) => {
            warn!("Got unexpected message type when Host message expected");
            send_msg(
                host_tx,
                ServerMessage::error("Unexpected message type: expected Host message"),
            );
            return;
        }
        Err(e) => {
            warn!("Failed to parse message: {text}");
            warn!("Error: {e}");
            send_msg(
                host_tx,
                ServerMessage::error("Server error: Failed to parse message"),
            );
            return;
        }
    };

    // Handle timer actions specially (they need to spawn async tasks)
    match action {
        HostAction::StartTimer { seconds } => {
            handle_start_timer(app_state, game_code, seconds).await;
            return;
        }
        HostAction::PauseTimer => {
            handle_pause_timer(app_state, game_code).await;
            return;
        }
        HostAction::ResetTimer => {
            handle_reset_timer(app_state, game_code).await;
            return;
        }
        _ => {
            // Handle other actions with the normal pattern
        }
    }

    // Acquire lock, mutate state, collect messages to send, then release lock
    let result = {
        let mut games_map = app_state.games.lock().await;
        let Some(game) = games_map.get_mut(game_code) else {
            error!("Game {game_code} not found while processing host message");
            return;
        };
        process_host_action(action, game)
    };
    // Lock released here

    // Send messages outside the lock
    send_msg(host_tx, result.host_msg);
    if let Some((team_tx, msg)) = result.team_msg {
        send_msg(&team_tx, msg);
    }
}

async fn handle_host(
    ws_stream: WebSocketStream<TcpStream>,
    app_state: Arc<AppState>,
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

    let app_state2 = app_state.clone();
    let game_code2 = game_code.clone();

    let read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            if let Ok(text) = msg.to_text() {
                if text.is_empty() {
                    log::warn!("Received empty message");
                    continue;
                }
                info!("Received message: {text}");
                process_host_message(text, &app_state2, &game_code2, &host_tx).await;
            }
        }
    });

    tokio::select! {
        _ = write_task => {},
        _ = read_task => {},
    }
    info!("Host disconnected, clearing host_tx");
    if let Some(game) = app_state.games.lock().await.get_mut(&game_code) {
        game.clear_host_tx();
    } else {
        error!("Game {game_code} not found in app_state when host disconnected");
    }
}

async fn join_game(
    app_state: Arc<AppState>,
    mut ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
    team_name: String,
    color_hex: String,
    team_members: Vec<String>,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Message>();
    let mut games_map = app_state.games.lock().await;
    if let Some(game) = games_map.get_mut(&game_code) {
        info!("Team {team_name} joined game {game_code}");
        let team_color = TeamColor {
            hex_code: color_hex,
            name: "Custom".to_string(), // Color name not provided by client
        };
        game.add_team(team_name.clone(), tx.clone(), team_color, team_members);

        // Send TeamGameState to the joining team
        if let Some(team_state) = game.to_team_game_state(&team_name) {
            let team_msg = ServerMessage::TeamGameState { state: team_state };
            send_msg(&tx, team_msg);
        }

        // Send updated GameState to host
        if let Some(host_tx) = &game.host_tx {
            let host_msg = ServerMessage::GameState {
                state: game.to_game_state(),
            };
            send_msg(host_tx, host_msg);
        }

        drop(games_map);
        handle_team(ws_stream, app_state, rx, tx, game_code, team_name).await;
    } else {
        drop(games_map);
        info!("Team {team_name} tried to join game {game_code}, but it doesn't exist");
        let error_message = ServerMessage::error(format!("Game code {game_code} not found"));
        let msg = serde_json::to_string(&error_message).unwrap();
        let _ = ws_stream.send(Message::text(msg)).await;
    }
}

/// Result of processing a team action: messages to send after releasing the lock
struct TeamActionResult {
    team_msg: ServerMessage,
    host_msg: Option<(Tx, ServerMessage)>, // (cloned host_tx, message)
}

/// Process a team action that mutates game state.
/// The game reference must be held under a lock; this function does not await.
fn process_team_action(action: TeamAction, game: &mut Game, team_name: &str) -> TeamActionResult {
    match action {
        TeamAction::JoinGame { .. } => TeamActionResult {
            team_msg: ServerMessage::error("Game already joined"),
            host_msg: None,
        },

        TeamAction::SubmitAnswer { answer, .. } => {
            // Check if submissions are open (timer must be running)
            if !game.timer_running {
                return TeamActionResult {
                    team_msg: ServerMessage::error("Submissions are closed"),
                    host_msg: None,
                };
            }

            // Add the answer
            if !game.add_answer(team_name, answer) {
                return TeamActionResult {
                    team_msg: ServerMessage::error("Answer already submitted"),
                    host_msg: None,
                };
            }

            // Build messages to send
            let team_msg = game
                .to_team_game_state(team_name)
                .map(|state| ServerMessage::TeamGameState { state })
                .unwrap_or_else(|| ServerMessage::error("Failed to get team state"));

            let host_msg = game.host_tx.clone().map(|tx| {
                (
                    tx,
                    ServerMessage::GameState {
                        state: game.to_game_state(),
                    },
                )
            });

            TeamActionResult { team_msg, host_msg }
        }
    }
}

async fn process_team_message(
    text: &str,
    app_state: &Arc<AppState>,
    game_code: &str,
    team_name: &str,
    team_tx: &Tx,
) {
    // Parse message before acquiring lock
    let action = match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::Team(action)) => action,
        Ok(_) => {
            send_msg(
                team_tx,
                ServerMessage::error("Unexpected message type: expected Team message"),
            );
            return;
        }
        Err(e) => {
            error!("Failed to parse message: {text}");
            error!("Error: {e}");
            send_msg(
                team_tx,
                ServerMessage::error("Server error: Failed to parse message"),
            );
            return;
        }
    };

    // Acquire lock, mutate state, collect messages to send, then release lock
    let result = {
        let mut games_map = app_state.games.lock().await;
        let Some(game) = games_map.get_mut(game_code) else {
            error!("Game {game_code} not found while processing team message from {team_name}");
            return;
        };
        process_team_action(action, game, team_name)
    };
    // Lock released here

    // Send messages outside the lock
    send_msg(team_tx, result.team_msg);
    if let Some((host_tx, msg)) = result.host_msg {
        send_msg(&host_tx, msg);
    }
}

async fn handle_team(
    ws_stream: WebSocketStream<TcpStream>,
    app_state: Arc<AppState>,
    mut rx: Rx,
    team_tx: Tx,
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

    let app_state2 = app_state.clone();
    let game_code2 = game_code.clone();
    let team_name2 = team_name.clone();

    let read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            if let Ok(text) = msg.to_text() {
                info!("Received message: {text}");
                process_team_message(text, &app_state2, &game_code2, &team_name2, &team_tx).await;
            }
        }
    });
    tokio::select! {
        _ = write_task => {},
        _ = read_task => {},
    }

    // Team disconnected - update state and notify host
    info!("Team {team_name} disconnected from game {game_code}");
    let host_tx = {
        let mut games_map = app_state.games.lock().await;
        if let Some(game) = games_map.get_mut(&game_code) {
            game.set_team_connected(&team_name, false);
            game.host_tx.clone().map(|tx| {
                (
                    tx,
                    ServerMessage::GameState {
                        state: game.to_game_state(),
                    },
                )
            })
        } else {
            None
        }
    };
    // Lock released here

    if let Some((tx, msg)) = host_tx {
        send_msg(&tx, msg);
    }
}

pub async fn start_ws_server(
    listener: TcpListener,
    timer: ShutdownTimer,
    validator: Arc<dyn JwtValidator>,
) {
    let addr = listener.local_addr().expect("Failed to get local address");
    info!("Listening on: {addr}");

    let app_state: Arc<AppState> = Arc::new(AppState {
        games: Mutex::new(HashMap::new()),
        timer: Mutex::new(timer),
        validator,
    });

    while let Ok((stream, _)) = listener.accept().await {
        let peer = stream
            .peer_addr()
            .expect("connected streams should have a peer address");
        info!("Peer address: {peer}");

        tokio::spawn(accept_connection(peer, stream, app_state.clone()));
    }
}
