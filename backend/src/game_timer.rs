use crate::model::game::Game;
use crate::model::server_message::{ServerMessage, send_msg};
use crate::server::AppState;
use log::error;
use std::sync::Arc;

/// Broadcast GameState to host and TeamGameState to all teams
fn broadcast_game_state(game: &Game) {
    // Send full GameState to host
    if let Some(host_tx) = &game.host_tx {
        send_msg(
            host_tx,
            ServerMessage::GameState {
                state: game.to_game_state(),
            },
        );
    }

    // Send filtered TeamGameState to each team
    for (team_name, team_tx) in &game.teams_tx {
        if let Some(team_state) = game.to_team_game_state(team_name) {
            send_msg(team_tx, ServerMessage::TeamGameState { state: team_state });
        }
    }
}

/// Broadcast a TimerTick to all connected clients (host + all teams)
fn broadcast_timer_tick(game: &Game, seconds_remaining: u32) {
    let msg = ServerMessage::TimerTick { seconds_remaining };
    if let Some(host_tx) = &game.host_tx {
        send_msg(host_tx, msg.clone());
    }
    for team_tx in game.teams_tx.values() {
        send_msg(team_tx, msg.clone());
    }
}

/// Handle StartTimer action: start/resume timer and spawn tick task
pub async fn handle_start_timer(app_state: &Arc<AppState>, game_code: &str, seconds: Option<u32>) {
    // First, update state and determine if we should spawn a timer task
    let should_spawn = {
        let mut games_map = app_state.games.lock().await;
        let Some(game) = games_map.get_mut(game_code) else {
            error!("Game {game_code} not found in handle_start_timer");
            return;
        };

        // Cancel existing timer if running
        if let Some(handle) = game.timer_abort_handle.take() {
            handle.abort();
        }

        // Set timer value: use provided seconds, or current value, or default to 30
        if let Some(secs) = seconds {
            game.timer_seconds_remaining = Some(secs);
        } else if game.timer_seconds_remaining.is_none() || game.timer_seconds_remaining == Some(0)
        {
            game.timer_seconds_remaining = Some(30);
        }

        // Start timer (opens submissions)
        game.timer_running = true;

        game.timer_seconds_remaining.unwrap_or(0) > 0
    };
    // Lock released

    // Broadcast initial state to all clients
    {
        let games_map = app_state.games.lock().await;
        if let Some(game) = games_map.get(game_code) {
            broadcast_game_state(game);
        }
    }

    // Spawn timer tick task if there's time remaining
    if should_spawn {
        let app_state2 = app_state.clone();
        let game_code2 = game_code.to_string();

        let task = tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

                // Lock, decrement, broadcast tick, check if done
                let (should_continue, tick_msg, final_state) = {
                    let mut games_map = app_state2.games.lock().await;
                    let Some(game) = games_map.get_mut(&game_code2) else {
                        error!("Tried to tick game timer, but game no longer exists!");
                        break; // Game no longer exists
                    };

                    if !game.timer_running {
                        error!("Tried to tick game timer, but timer shouldn't be running!");
                        break; // Timer was paused
                    }

                    let Some(remaining) = game.timer_seconds_remaining else {
                        error!("Tried to tick game timer, but timer_seconds_remaining was None!");
                        break; // No timer set
                    };

                    if remaining == 0 {
                        error!("Tried to tick game timer, but it was already at zero!");
                        break; // Already at 0
                    }

                    let new_remaining = remaining - 1;
                    game.timer_seconds_remaining = Some(new_remaining);

                    if new_remaining == 0 {
                        // Timer expired - close submissions
                        game.timer_running = false;
                        game.timer_abort_handle = None;
                        let final_state = game.to_game_state();
                        (false, None, Some(final_state))
                    } else {
                        // Continue ticking
                        let tick_msg = ServerMessage::TimerTick {
                            seconds_remaining: new_remaining,
                        };
                        (true, Some(tick_msg), None)
                    }
                };
                // Lock released

                // Broadcast tick or final state
                if let Some(ServerMessage::TimerTick { seconds_remaining }) = tick_msg {
                    let games_map = app_state2.games.lock().await;
                    if let Some(game) = games_map.get(&game_code2) {
                        broadcast_timer_tick(game, seconds_remaining);
                    }
                }

                if final_state.is_some() {
                    let games_map = app_state2.games.lock().await;
                    if let Some(game) = games_map.get(&game_code2) {
                        broadcast_game_state(game);
                    }
                }

                if !should_continue {
                    break;
                }
            }
        });

        // Store abort handle
        let mut games_map = app_state.games.lock().await;
        if let Some(game) = games_map.get_mut(game_code) {
            game.timer_abort_handle = Some(task.abort_handle());
        }
    }
}

/// Handle PauseTimer action: stop timer task and close submissions
pub async fn handle_pause_timer(app_state: &Arc<AppState>, game_code: &str) {
    {
        let mut games_map = app_state.games.lock().await;
        let Some(game) = games_map.get_mut(game_code) else {
            error!("Game {game_code} not found in handle_pause_timer");
            return;
        };

        // Cancel timer task if running
        if let Some(handle) = game.timer_abort_handle.take() {
            handle.abort();
        }

        // Close submissions
        game.timer_running = false;
    };
    // Lock released

    // Broadcast updated state
    let games_map = app_state.games.lock().await;
    if let Some(game) = games_map.get(game_code) {
        broadcast_game_state(game);
    }
}

/// Handle ResetTimer action: stop timer task, reset to default, close submissions
pub async fn handle_reset_timer(app_state: &Arc<AppState>, game_code: &str) {
    {
        let mut games_map = app_state.games.lock().await;
        let Some(game) = games_map.get_mut(game_code) else {
            error!("Game {game_code} not found in handle_reset_timer");
            return;
        };

        // Cancel timer task if running
        if let Some(handle) = game.timer_abort_handle.take() {
            handle.abort();
        }

        // Reset to default duration
        game.timer_seconds_remaining = Some(30);
        game.timer_running = false;
    };
    // Lock released

    // Broadcast updated state
    let games_map = app_state.games.lock().await;
    if let Some(game) = games_map.get(game_code) {
        broadcast_game_state(game);
    }
}
