use log::{error, info};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite::Message;

use crate::Tx;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostServerMessage {
    #[serde(rename_all = "camelCase")]
    GameCreated { game_code: String },
    #[serde(rename_all = "camelCase")]
    NewAnswer { answer: String, team_name: String },
    #[serde(rename_all = "camelCase")]
    ScoreUpdate { team_name: String, score: i32 },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TeamServerMessage {
    #[serde(rename_all = "camelCase")]
    GameJoined { game_code: String },
    AnswerSubmitted,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerMessage {
    Host(HostServerMessage),
    Team(TeamServerMessage),
    Error(String),
}

pub fn send_msg(tx: &Tx, msg: ServerMessage) {
    info!("Sending server message: {:?}", msg);
    let msg = serde_json::to_string(&msg).unwrap_or_else(|e| {
        format!("Catastrophic! Serde error when trying to serialize serverside: {e}")
            .to_string()
    });
    tx.send(Message::text(&msg)).unwrap_or_else(|e| {
        error!("Sending server message through channel failed: {e}");
        error!("Tried to send message: {msg}");
    })
}
