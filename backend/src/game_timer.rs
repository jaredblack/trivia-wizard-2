use crate::model::game::Game;
use crate::model::server_message::{ServerMessage, send_msg};
use crate::server::AppState;
use log::error;
use std::sync::Arc;

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

/// Start/resume timer and spawn tick task. Called while holding game lock.
/// Does not broadcast - caller should broadcast after releasing lock.
pub fn start_timer(game: &mut Game, app_state: &Arc<AppState>, game_code: &str) {
    // Cancel existing timer if running
    if let Some(handle) = game.timer_abort_handle.take() {
        handle.abort();
    }

    // Set timer value: use current remaining time if > 0, otherwise use question's timer_duration
    if game.timer_seconds_remaining.is_none() || game.timer_seconds_remaining == Some(0) {
        game.timer_seconds_remaining = Some(game.current_question().timer_duration);
    }

    // Start timer (opens submissions)
    game.timer_running = true;

    // Spawn timer tick task if there's time remaining
    if game.timer_seconds_remaining.unwrap_or(0) > 0 {
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
                        game.broadcast_game_state();
                    }
                }

                if !should_continue {
                    break;
                }
            }
        });

        // Store abort handle
        game.timer_abort_handle = Some(task.abort_handle());
    }
}

/// Pause timer: stop timer task and close submissions. Called while holding game lock.
/// Does not broadcast - caller should broadcast after releasing lock.
pub fn pause_timer(game: &mut Game) {
    // Cancel timer task if running
    if let Some(handle) = game.timer_abort_handle.take() {
        handle.abort();
    }

    // Close submissions
    game.timer_running = false;
}

/// Reset timer: stop timer task, reset to current question's duration, close submissions.
/// Called while holding game lock. Does not broadcast - caller should broadcast after releasing lock.
pub fn reset_timer(game: &mut Game) {
    // Cancel timer task if running
    if let Some(handle) = game.timer_abort_handle.take() {
        handle.abort();
    }

    // Reset to current question's timer duration
    game.timer_seconds_remaining = Some(game.current_question().timer_duration);
    game.timer_running = false;
}
