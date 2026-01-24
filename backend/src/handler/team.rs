use crate::{
    heartbeat::{HeartbeatState, PING_INTERVAL},
    model::{
        client_message::{ClientMessage, TeamAction},
        game::Game,
        server_message::{ServerMessage, send_msg},
        types::TeamColor,
    },
    server::{AppState, Rx, Tx},
};
use futures_util::{SinkExt, StreamExt};
use log::*;
use std::sync::Arc;
use tokio::{net::TcpStream, sync::mpsc};
use tokio_tungstenite::{WebSocketStream, tungstenite::Message};

pub async fn join_game(
    app_state: Arc<AppState>,
    mut ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
    team_name: String,
    color_hex: String,
    color_name: String,
    team_members: Vec<String>,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Message>();
    let mut games_map = app_state.games.lock().await;
    if let Some(game) = games_map.get_mut(&game_code) {
        info!("Team {team_name} joined game {game_code}");
        let team_color = TeamColor {
            hex_code: color_hex,
            name: color_name,
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

        // Notify watchers of team change
        game.broadcast_scoreboard_data();

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

/// Rejoin an existing team - preserves color and members from initial join.
/// TeamGameState was already sent in the ValidateJoin response.
pub async fn rejoin_game(
    app_state: Arc<AppState>,
    ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
    team_name: String,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Message>();
    let mut games_map = app_state.games.lock().await;
    if let Some(game) = games_map.get_mut(&game_code) {
        info!("Team {team_name} rejoining game {game_code}");
        game.rejoin_team(&team_name, tx.clone());

        // TeamGameState already sent in ValidateJoin response, don't send again

        // Send updated GameState to host (so they see team is back)
        if let Some(host_tx) = &game.host_tx {
            let host_msg = ServerMessage::GameState {
                state: game.to_game_state(),
            };
            send_msg(host_tx, host_msg);
        }

        // Notify watchers of team reconnection
        game.broadcast_scoreboard_data();

        drop(games_map);
        handle_team(ws_stream, app_state, rx, tx, game_code, team_name).await;
    } else {
        drop(games_map);
        // This shouldn't happen since we validated in ValidateJoin
        error!("Team {team_name} tried to rejoin game {game_code}, but it doesn't exist");
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
        TeamAction::ValidateJoin { .. } => TeamActionResult {
            team_msg: ServerMessage::error("Already validated"),
            host_msg: None,
        },

        TeamAction::JoinGame { .. } => TeamActionResult {
            team_msg: ServerMessage::error("Game already joined"),
            host_msg: None,
        },

        TeamAction::SubmitAnswer { answer, .. } => {
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

    if let ServerMessage::Error { message, state: _ } = &result.team_msg {
        warn!("Sending error response '{message}' back to team {team_name}");
    }

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
    let mut heartbeat = HeartbeatState::new();
    let mut ping_interval = tokio::time::interval(PING_INTERVAL);

    loop {
        tokio::select! {
            // Outgoing messages from channel
            Some(msg) = rx.recv() => {
                if ws_write.send(msg).await.is_err() {
                    break;
                }
            }

            // Incoming messages from WebSocket
            msg_result = ws_read.next() => {
                match msg_result {
                    Some(Ok(Message::Pong(_))) => {
                        heartbeat.record_pong();
                    }
                    Some(Ok(Message::Text(text))) => {
                        info!("Received message: {text}");
                        process_team_message(&text, &app_state, &game_code, &team_name, &team_tx).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Err(_)) => {
                        break;
                    }
                    _ => {} // Ignore Ping (auto-handled by tungstenite), Binary
                }
            }

            // Heartbeat ping timer
            _ = ping_interval.tick() => {
                if !heartbeat.is_alive() {
                    info!("Team {team_name} connection timed out (no pong received)");
                    break;
                }
                if ws_write.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }
        }
    }

    // Team disconnected - update state and notify host
    info!("Team {team_name} disconnected from game {game_code}");
    let host_tx = {
        let mut games_map = app_state.games.lock().await;
        if let Some(game) = games_map.get_mut(&game_code) {
            game.set_team_connected(&team_name, false);
            game.clear_team_tx(&team_name);
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
