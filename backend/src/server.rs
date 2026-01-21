use crate::{
    auth::{AuthResult, JwtValidator},
    handler::{host, team, watcher},
    infra,
    model::{
        client_message::{ClientMessage, HostAction, TeamAction, WatcherAction},
        game::Game,
        server_message::ServerMessage,
    },
    persistence::PersistenceClient,
    timer::ShutdownTimer,
};
use futures_util::{SinkExt, StreamExt};
use log::*;
use rand::Rng;
use std::{collections::HashMap, sync::Arc};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Mutex, mpsc},
};
use tokio_tungstenite::{
    accept_hdr_async,
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
    pub persistence: Arc<PersistenceClient>,
}

fn generate_code() -> String {
    rand::rng()
        .sample_iter(&rand::distr::Alphabetic)
        .take(4)
        .map(|c| (c as char).to_ascii_uppercase())
        .collect()
}

async fn accept_connection(stream: TcpStream, app_state: Arc<AppState>) {
    if let Err(e) = handle_connection(stream, app_state.clone()).await {
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

async fn handle_connection(stream: TcpStream, app_state: Arc<AppState>) -> Result<()> {
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
        if let Message::Text(text) = msg {
            info!("Received message: {text}");
            match serde_json::from_str::<ClientMessage>(&text) {
                Ok(client_message) => {
                    info!("Parsed message: {client_message:?}");
                    match client_message {
                        ClientMessage::Host(action) => {
                            // Host actions require authentication
                            match &auth_result {
                                Some(auth) if auth.is_host => {
                                    if let HostAction::CreateGame { game_code } = action {
                                        let code = game_code.unwrap_or_else(generate_code);
                                        host::create_game(
                                            app_state,
                                            ws_stream,
                                            code,
                                            auth.user_id.clone(),
                                        )
                                        .await;
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
                            if let TeamAction::ValidateJoin {
                                game_code,
                                team_name,
                            } = action
                            {
                                // Validate game code and team name
                                let response = {
                                    let games_map = app_state.games.lock().await;
                                    if let Some(game) = games_map.get(&game_code) {
                                        // Check if team exists and its connection status
                                        if let Some(team_data) = game.find_team(&team_name) {
                                            if team_data.connected {
                                                ServerMessage::error("Team name already in use")
                                            } else {
                                                // Rejoin path - return TeamGameState
                                                game.to_team_game_state(&team_name)
                                                    .map(|state| ServerMessage::TeamGameState {
                                                        state,
                                                    })
                                                    .unwrap_or_else(|| {
                                                        ServerMessage::error(
                                                            "Failed to get team state",
                                                        )
                                                    })
                                            }
                                        } else {
                                            ServerMessage::JoinValidated
                                        }
                                    } else {
                                        ServerMessage::error("Game code not found")
                                    }
                                };

                                // Send response
                                let msg = serde_json::to_string(&response).unwrap();
                                ws_stream.send(Message::text(msg)).await?;

                                match response {
                                    ServerMessage::Error { .. } => {
                                        // Error case: terminate connection
                                        return Ok(());
                                    }
                                    ServerMessage::TeamGameState { .. } => {
                                        // Rejoin case: enter game loop immediately
                                        team::rejoin_game(
                                            app_state, ws_stream, game_code, team_name,
                                        )
                                        .await;
                                    }
                                    ServerMessage::JoinValidated => {
                                        // New team case: wait for JoinGame message
                                        if let Some(Ok(msg)) = ws_stream.next().await {
                                            if let Message::Text(text) = msg {
                                                match serde_json::from_str::<ClientMessage>(&text) {
                                                    Ok(ClientMessage::Team(
                                                        TeamAction::JoinGame {
                                                            game_code,
                                                            team_name,
                                                            color_hex,
                                                            color_name,
                                                            team_members,
                                                        },
                                                    )) => {
                                                        team::join_game(
                                                            app_state,
                                                            ws_stream,
                                                            game_code,
                                                            team_name,
                                                            color_hex,
                                                            color_name,
                                                            team_members,
                                                        )
                                                        .await;
                                                    }
                                                    _ => {
                                                        let error = ServerMessage::error(
                                                            "Expected JoinGame after ValidateJoin",
                                                        );
                                                        let msg =
                                                            serde_json::to_string(&error).unwrap();
                                                        ws_stream.send(Message::text(msg)).await?;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            } else {
                                error!(
                                    "Expected ValidateJoin from new Team connection, instead got: {action:?}"
                                );
                                let error_message =
                                    ServerMessage::error("First action must be ValidateJoin");
                                let msg = serde_json::to_string(&error_message).unwrap();
                                ws_stream.send(Message::text(msg)).await?;
                            }
                        }
                        ClientMessage::Watcher(action) => {
                            // Watchers don't require authentication (public access)
                            info!("Watcher message: {action:?}");
                            let WatcherAction::WatchGame { game_code } = action;
                            watcher::watch_game(app_state, ws_stream, game_code).await;
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

pub async fn start_ws_server(
    listener: TcpListener,
    timer: ShutdownTimer,
    validator: Arc<dyn JwtValidator>,
    persistence: Arc<PersistenceClient>,
) {
    let addr = listener.local_addr().expect("Failed to get local address");
    info!("Listening on: {addr}");

    let app_state: Arc<AppState> = Arc::new(AppState {
        games: Mutex::new(HashMap::new()),
        timer: Mutex::new(timer),
        validator,
        persistence,
    });

    while let Ok((stream, _)) = listener.accept().await {
        let peer = stream
            .peer_addr()
            .expect("connected streams should have a peer address");
        info!("Peer address: {peer}");

        tokio::spawn(accept_connection(stream, app_state.clone()));
    }
}
