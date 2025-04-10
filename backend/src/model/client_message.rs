use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostAction {
    CreateGame,
    #[serde(rename_all = "camelCase")]
    ScoreAnswer {
        team_name: String,
        answer: String,
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TeamAction {
    #[serde(rename_all = "camelCase")]
    JoinGame {
        team_name: String,
        game_code: String,
    },

    #[serde(rename_all = "camelCase")]
    SubmitAnswer {
        team_name: String,
        answer: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientMessage {
    Host(HostAction),
    Team(TeamAction),
}
