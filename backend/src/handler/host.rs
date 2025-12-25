use crate::{
    game_timer::{pause_timer, reset_timer, start_timer},
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

    // Check if game exists
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

        // Game exists but host disconnected - reclaim it
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

    // Game doesn't exist - create it
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

/// How to send messages to teams after processing a host action
enum TeamMessage {
    Single(Tx, ServerMessage), // Send to one specific team
    Broadcast,                 // Broadcast to all teams (constructs TeamGameState for each)
}

/// Result of processing a host action: messages to send after releasing the lock
struct HostActionResult {
    host_msg: ServerMessage,
    team_msg: Option<TeamMessage>,
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
        },

        // Timer actions
        HostAction::StartTimer => {
            start_timer(game, app_state, game_code);
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
            }
        }

        HostAction::PauseTimer => {
            pause_timer(game);
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
            }
        }

        HostAction::ResetTimer => {
            reset_timer(game);
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
            }
        }

        // Question navigation actions
        HostAction::NextQuestion => {
            game.next_question();
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
            }
        }

        HostAction::PrevQuestion => match game.prev_question() {
            Ok(()) => HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
            },
            Err(msg) => HostActionResult {
                host_msg: ServerMessage::error(msg),
                team_msg: None,
            },
        },

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
                    game.to_team_game_state(&team_name).map(|state| {
                        TeamMessage::Single(tx, ServerMessage::TeamGameState { state })
                    })
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

        HostAction::OverrideTeamScore {
            team_name,
            override_points,
        } => {
            if game.override_team_score(&team_name, override_points) {
                let host_msg = ServerMessage::GameState {
                    state: game.to_game_state(),
                };
                let team_msg = game.teams_tx.get(&team_name).cloned().and_then(|tx| {
                    game.to_team_game_state(&team_name).map(|state| {
                        TeamMessage::Single(tx, ServerMessage::TeamGameState { state })
                    })
                });
                HostActionResult { host_msg, team_msg }
            } else {
                HostActionResult {
                    host_msg: ServerMessage::error(format!("Team '{}' not found", team_name)),
                    team_msg: None,
                }
            }
        }

        // Settings actions
        HostAction::UpdateGameSettings {
            default_timer_duration,
            default_question_points,
            default_bonus_increment,
            default_question_type,
        } => {
            let settings = GameSettings {
                default_timer_duration,
                default_question_points,
                default_bonus_increment,
                default_question_type,
            };
            game.update_game_settings(settings);
            HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
            }
        }

        HostAction::UpdateQuestionSettings {
            question_number,
            timer_duration,
            question_points,
            bonus_increment,
            question_type,
        } => match game.update_question_settings(
            question_number,
            timer_duration,
            question_points,
            bonus_increment,
            question_type,
        ) {
            Ok(()) => HostActionResult {
                host_msg: ServerMessage::GameState {
                    state: game.to_game_state(),
                },
                team_msg: Some(TeamMessage::Broadcast),
            },
            Err(msg) => HostActionResult {
                host_msg: ServerMessage::error(msg),
                team_msg: None,
            },
        },
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

    // Acquire lock, mutate state, collect messages to send, then release lock
    let result = {
        let mut games_map = app_state.games.lock().await;
        let Some(game) = games_map.get_mut(game_code) else {
            error!("Game {game_code} not found while processing host message");
            return;
        };
        process_host_action(action, game, app_state, game_code)
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
