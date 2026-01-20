use crate::{
    game_timer::{pause_timer, reset_timer, start_timer},
    heartbeat::{HeartbeatState, PING_INTERVAL},
    model::{
        client_message::{ClientMessage, HostAction},
        game::Game,
        server_message::{ServerMessage, send_msg},
        types::GameSettings,
    },
    server::{AppState, Rx, Tx},
};
use futures_util::{SinkExt, StreamExt};
use log::*;
use std::sync::Arc;
use tokio::{net::TcpStream, sync::mpsc};
use tokio_tungstenite::{WebSocketStream, tungstenite::Message};

pub async fn create_game(
    app_state: Arc<AppState>,
    mut ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
    user_id: String,
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

    // Check if game exists in memory
    if let Some(existing_game) = games_map.get_mut(&game_code) {
        // If game has a host, return error
        if existing_game.host_tx.is_some() {
            info!("Cannot create/reclaim game {game_code}: host already connected");
            let error_msg =
                ServerMessage::error(format!("Game '{}' already has an active host", game_code));
            let msg = serde_json::to_string(&error_msg).unwrap();
            drop(games_map);
            let _ = ws_stream.send(Message::text(msg)).await;
            return;
        }

        // Game exists but host disconnected - check ownership before reclaiming
        if existing_game.host_user_id != user_id {
            info!("User {user_id} cannot reclaim game {game_code}: owned by {}", existing_game.host_user_id);
            let error_msg = ServerMessage::error(format!("Game code '{}' already exists", game_code));
            let msg = serde_json::to_string(&error_msg).unwrap();
            drop(games_map);
            let _ = ws_stream.send(Message::text(msg)).await;
            return;
        }

        info!("Host reclaiming existing game: {game_code}");
        existing_game.set_host_tx(tx.clone());
        let msg = ServerMessage::GameState {
            state: existing_game.to_game_state(),
        };
        drop(games_map);
        send_msg(&tx, msg);
        handle_host(ws_stream, app_state, rx, tx, game_code, user_id).await;
        return;
    }

    // Game not in memory - try to restore from S3
    drop(games_map);  // Release lock while doing async S3 call

    match app_state.persistence.load_game_state(&user_id, &game_code).await {
        Ok(Some(state)) => {
            // Restore game from S3
            info!("Restoring game {game_code} from S3 for user {user_id}");
            let game = Game::from_saved_state(user_id.clone(), game_code.clone(), tx.clone(), state);
            let msg = ServerMessage::GameState {
                state: game.to_game_state(),
            };
            app_state.games.lock().await.insert(game_code.clone(), game);
            send_msg(&tx, msg);
            handle_host(ws_stream, app_state, rx, tx, game_code, user_id).await;
        }
        Ok(None) => {
            // No saved state - create new game
            info!("Creating new game: {game_code}");
            let game = Game::new(game_code.clone(), tx.clone(), user_id.clone());
            let msg = ServerMessage::GameState {
                state: game.to_game_state(),
            };
            app_state.games.lock().await.insert(game_code.clone(), game);
            send_msg(&tx, msg);
            handle_host(ws_stream, app_state, rx, tx, game_code, user_id).await;
        }
        Err(e) => {
            // Error loading (e.g., incompatible save format)
            warn!("Error restoring game {game_code} from S3: {e}");
            let error_msg = ServerMessage::error(e.to_string());
            let msg = serde_json::to_string(&error_msg).unwrap();
            let _ = ws_stream.send(Message::text(msg)).await;
        }
    }
}

/// How to send messages to teams after processing a host action
enum TeamMessage {
    Single(Tx, ServerMessage), // Send to one specific team
    Broadcast,                 // Broadcast to all teams (constructs TeamGameState for each)
}

/// Result of processing a host action: messages to send after releasing the lock
struct HostActionResult {
    host_msg: ServerMessage,
    team_msg: Option<TeamMessage>,
    should_persist: bool,
}

/// Process a host action that mutates game state.
/// The game reference must be held under a lock; this function does not await.
fn process_host_action(
    action: HostAction,
    game: &mut Game,
    app_state: &Arc<AppState>,
    game_code: &str,
) -> HostActionResult {
    match action {
        HostAction::CreateGame { .. } => HostActionResult {
            host_msg: ServerMessage::error("Game already created"),
            team_msg: None,
            should_persist: false,
        },
        HostAction::StartTimer => {
            start_timer(game, app_state, game_code);
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
                should_persist: false,
            }
        }
        HostAction::PauseTimer => {
            pause_timer(game);
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
                should_persist: false,
            }
        }
        HostAction::ResetTimer => {
            reset_timer(game);
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
                should_persist: false,
            }
        }
        HostAction::NextQuestion => {
            game.next_question();
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
                should_persist: true,
            }
        }
        HostAction::PrevQuestion => match game.prev_question() {
            Ok(()) => HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
                should_persist: true,
            },
            Err(msg) => HostActionResult {
                host_msg: ServerMessage::error(msg),
                team_msg: None,
                should_persist: false,
            },
        },
        HostAction::ScoreAnswer {
            question_number,
            team_name,
            score,
        } => {
            if game.score_answer(question_number, &team_name, score) {
                // Broadcast to all teams since auto-scoring may affect multiple teams
                HostActionResult {
                    host_msg: ServerMessage::GameState {
                        state: game.to_game_state(),
                    },
                    team_msg: Some(TeamMessage::Broadcast),
                    should_persist: false,
                }
            } else {
                HostActionResult {
                    host_msg: ServerMessage::error(format!(
                        "Failed to score answer for team '{}'",
                        team_name
                    )),
                    team_msg: None,
                    should_persist: false,
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
                let team_msg = game
                    .teams_tx
                    .get(&team_name.to_lowercase())
                    .cloned()
                    .and_then(|tx| {
                        game.to_team_game_state(&team_name).map(|state| {
                            TeamMessage::Single(tx, ServerMessage::TeamGameState { state })
                        })
                    });
                HostActionResult { host_msg, team_msg, should_persist: false }
            } else {
                HostActionResult {
                    host_msg: ServerMessage::error(format!("Team '{}' not found", team_name)),
                    team_msg: None,
                    should_persist: false,
                }
            }
        }
        HostAction::UpdateGameSettings {
            default_timer_duration,
            default_question_points,
            default_bonus_increment,
            default_question_type,
            default_mc_config,
            speed_bonus_enabled,
            speed_bonus_num_teams,
            speed_bonus_first_place_points,
        } => {
            let settings = GameSettings {
                default_timer_duration,
                default_question_points,
                default_bonus_increment,
                default_question_type,
                default_mc_config,
                speed_bonus_enabled,
                speed_bonus_num_teams,
                speed_bonus_first_place_points,
            };
            game.update_game_settings(settings);
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
                should_persist: false,
            }
        }
        HostAction::UpdateQuestionSettings {
            question_number,
            timer_duration,
            question_points,
            bonus_increment,
            question_type,
            speed_bonus_enabled,
        } => match game.update_question_settings(
            question_number,
            timer_duration,
            question_points,
            bonus_increment,
            question_type,
            speed_bonus_enabled,
        ) {
            Ok(()) => HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
                should_persist: false,
            },
            Err(msg) => HostActionResult {
                host_msg: ServerMessage::error(msg.to_string()),
                team_msg: None,
                should_persist: false,
            },
        },
        HostAction::UpdateTypeSpecificSettings {
            question_number,
            question_config,
        } => match game.update_type_specific_settings(question_number, question_config) {
            Ok(()) => HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
                should_persist: false,
            },
            Err(msg) => HostActionResult {
                host_msg: ServerMessage::error(msg.to_string()),
                team_msg: None,
                should_persist: false,
            },
        },
    }
}

async fn process_host_message(
    text: &str,
    app_state: &Arc<AppState>,
    game_code: &str,
    user_id: &str,
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

    // Acquire lock, mutate state, collect messages to send, then release lock
    let (result, game_state_for_persist) = {
        let mut games_map = app_state.games.lock().await;
        let Some(game) = games_map.get_mut(game_code) else {
            error!("Game {game_code} not found while processing host message");
            return;
        };
        let result = process_host_action(action, game, app_state, game_code);
        let state = if result.should_persist {
            Some(game.to_game_state())
        } else {
            None
        };
        (result, state)
    };
    // Lock released here

    // Send messages outside the lock
    send_msg(host_tx, result.host_msg);
    match result.team_msg {
        Some(TeamMessage::Single(team_tx, msg)) => {
            send_msg(&team_tx, msg);
        }
        Some(TeamMessage::Broadcast) => {
            // Re-acquire lock to broadcast to all teams
            let games_map = app_state.games.lock().await;
            if let Some(game) = games_map.get(game_code) {
                // Send to all teams (host already received message above)
                for (team_name, team_tx) in &game.teams_tx {
                    if let Some(team_state) = game.to_team_game_state(team_name) {
                        send_msg(team_tx, ServerMessage::TeamGameState { state: team_state });
                    }
                }
            }
        }
        None => {}
    }

    // Persist game state to S3 if needed
    if let Some(state) = game_state_for_persist
        && let Err(e) = app_state.persistence.save_game_state(user_id, game_code, &state).await
    {
        warn!("Failed to save game state to S3: {e}");
        send_msg(host_tx, ServerMessage::error(format!("Failed to save game state: {e}")));
    }
}

async fn handle_host(
    ws_stream: WebSocketStream<TcpStream>,
    app_state: Arc<AppState>,
    mut rx: Rx,
    host_tx: Tx,
    game_code: String,
    user_id: String,
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
                        if text.is_empty() {
                            log::warn!("Received empty message");
                            continue;
                        }
                        info!("Received message: {text}");
                        process_host_message(&text, &app_state, &game_code, &user_id, &host_tx).await;
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
                    info!("Host connection timed out (no pong received)");
                    break;
                }
                if ws_write.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }
        }
    }

    info!("Host disconnected, clearing host_tx");
    // Get game state and clear host_tx
    let game_state = {
        let mut games_map = app_state.games.lock().await;
        if let Some(game) = games_map.get_mut(&game_code) {
            game.clear_host_tx();
            Some(game.to_game_state())
        } else {
            error!("Game {game_code} not found in app_state when host disconnected");
            None
        }
    };

    // Fire-and-forget save to S3 on disconnect
    if let Some(state) = game_state {
        let persistence = app_state.persistence.clone();
        let user_id = user_id.clone();
        let game_code = game_code.clone();
        tokio::spawn(async move {
            if let Err(e) = persistence.save_game_state(&user_id, &game_code, &state).await {
                warn!("Failed to save game state on disconnect: {e}");
            } else {
                info!("Saved game state on host disconnect: {game_code}");
            }
        });
    }
}
