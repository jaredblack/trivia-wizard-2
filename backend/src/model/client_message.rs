use serde::{Deserialize, Serialize};

use crate::model::types::ScoreData;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum HostAction {
    #[serde(rename_all = "camelCase")]
    CreateGame {
        #[serde(skip_serializing_if = "Option::is_none")]
        game_code: Option<String>,
    },

    #[serde(rename_all = "camelCase")]
    StartTimer {
        seconds: Option<u32>,
    },
    PauseTimer,
    ResetTimer,

    #[serde(rename_all = "camelCase")]
    ScoreAnswer {
        question_number: usize,
        team_name: String,
        score: ScoreData,
    },

    #[serde(rename_all = "camelCase")]
    OverrideTeamScore {
        team_name: String,
        override_points: i32,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TeamAction {
    #[serde(rename_all = "camelCase")]
    JoinGame {
        team_name: String,
        game_code: String,
        color_hex: String,
        color_name: String,
        team_members: Vec<String>,
    },

    #[serde(rename_all = "camelCase")]
    SubmitAnswer { team_name: String, answer: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientMessage {
    Host(HostAction),
    Team(TeamAction),
}
