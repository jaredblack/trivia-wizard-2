use log::{error, info};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite::Message;

use crate::model::types::{GameSettings, Question, TeamData, TeamQuestion};
use crate::server::Tx;

// === GameState (Server → Host) ===

/// The complete game state sent to the host on every update.
/// Submissions are open iff `timer_running` is true.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    pub game_code: String,
    pub current_question_number: usize,
    pub timer_running: bool,
    pub timer_seconds_remaining: Option<u32>,
    pub teams: Vec<TeamData>,
    pub questions: Vec<Question>,
    pub game_settings: GameSettings,
}

// === TeamGameState (Server → Team) ===

/// Filtered game state for team clients.
/// Does not include other teams' answers or scoring details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamGameState {
    pub game_code: String,
    pub current_question_number: usize,
    pub timer_running: bool,
    pub timer_seconds_remaining: Option<u32>,
    pub team: TeamData,
    pub questions: Vec<TeamQuestion>,
}

// === Server Messages ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ServerMessage {
    /// Full game state update (sent to host)
    #[serde(rename_all = "camelCase")]
    GameState { state: GameState },

    /// Filtered game state update (sent to team)
    #[serde(rename_all = "camelCase")]
    TeamGameState { state: TeamGameState },

    /// Simple acknowledgement that join validation passed (new team, game exists)
    JoinValidated,

    /// Lightweight timer tick (sent to all clients each second while timer runs)
    #[serde(rename_all = "camelCase")]
    TimerTick { seconds_remaining: u32 },

    /// Error with optional state for rollback
    #[serde(rename_all = "camelCase")]
    Error {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<GameState>,
    },
}

impl ServerMessage {
    /// Create an error message without rollback state
    pub fn error(message: impl Into<String>) -> Self {
        ServerMessage::Error {
            message: message.into(),
            state: None,
        }
    }
}

pub fn send_msg(tx: &Tx, msg: ServerMessage) {
    info!("Sending server message: {msg:?}");
    let msg = serde_json::to_string(&msg).unwrap_or_else(|e| {
        format!("Catastrophic! Serde error when trying to serialize serverside: {e}").to_string()
    });
    tx.send(Message::text(&msg)).unwrap_or_else(|e| {
        error!("Sending server message through channel failed: {e}");
        error!("Tried to send message: {msg}");
    })
}
