use serde::{Deserialize, Serialize};

use crate::model::types::{McConfig, QuestionKind, ScoreData};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum HostAction {
    #[serde(rename_all = "camelCase")]
    CreateGame {
        #[serde(skip_serializing_if = "Option::is_none")]
        game_code: Option<String>,
    },

    StartTimer,
    PauseTimer,
    ResetTimer,

    NextQuestion,
    PrevQuestion,

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

    #[serde(rename_all = "camelCase")]
    UpdateGameSettings {
        default_timer_duration: u32,
        default_question_points: u32,
        default_bonus_increment: u32,
        default_question_type: QuestionKind,
        default_mc_config: McConfig,
    },

    #[serde(rename_all = "camelCase")]
    UpdateQuestionSettings {
        question_number: usize,
        timer_duration: u32,
        question_points: u32,
        bonus_increment: u32,
        question_type: QuestionKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        mc_config: Option<McConfig>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TeamAction {
    #[serde(rename_all = "camelCase")]
    ValidateJoin {
        team_name: String,
        game_code: String,
    },

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
