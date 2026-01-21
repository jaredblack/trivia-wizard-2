use crate::{
    heartbeat::{HeartbeatState, PING_INTERVAL},
    model::server_message::{ServerMessage, send_msg},
    server::{AppState, Rx, Tx},
};
use futures_util::{SinkExt, StreamExt};
use log::*;
use std::sync::Arc;
use tokio::{net::TcpStream, sync::mpsc};
use tokio_tungstenite::{WebSocketStream, tungstenite::Message};

pub async fn watch_game(
    app_state: Arc<AppState>,
    mut ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Message>();

    // Validate game exists and add watcher
    let initial_data = {
        let mut games_map = app_state.games.lock().await;
        if let Some(game) = games_map.get_mut(&game_code) {
            info!("Watcher connected to game {game_code}");
            game.add_watcher(tx.clone());
            Some(game.to_scoreboard_data())
        } else {
            None
        }
    };

    match initial_data {
        Some(scoreboard_data) => {
            // Send initial scoreboard data
            send_msg(
                &tx,
                ServerMessage::ScoreboardData {
                    data: scoreboard_data,
                },
            );
            // Enter watcher loop
            handle_watcher(ws_stream, app_state, rx, tx, game_code).await;
        }
        None => {
            info!("Watcher tried to connect to non-existent game {game_code}");
            let error_message = ServerMessage::error(format!("Game code {game_code} not found"));
            let msg = serde_json::to_string(&error_message).unwrap();
            let _ = ws_stream.send(Message::text(msg)).await;
        }
    }
}

async fn handle_watcher(
    ws_stream: WebSocketStream<TcpStream>,
    app_state: Arc<AppState>,
    mut rx: Rx,
    watcher_tx: Tx,
    game_code: String,
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
                        // Watchers are read-only, ignore incoming messages
                        info!("Ignoring message from watcher: {text}");
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
                    info!("Watcher connection timed out (no pong received)");
                    break;
                }
                if ws_write.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }
        }
    }

    // Watcher disconnected - remove from game
    info!("Watcher disconnected from game {game_code}");
    let mut games_map = app_state.games.lock().await;
    if let Some(game) = games_map.get_mut(&game_code) {
        game.remove_watcher(&watcher_tx);
    }
}
