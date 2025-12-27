use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// === Question Kind (discriminant only, no data) ===

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuestionKind {
    Standard,
    MultiAnswer,
    MultipleChoice,
}

// === Score Types ===

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreData {
    pub question_points: i32,
    pub bonus_points: i32,
    pub override_points: i32,
}

impl ScoreData {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_score(&self) -> i32 {
        self.question_points + self.bonus_points + self.override_points
    }
}

// === Team Response Types ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamResponse {
    pub team_name: String,
    pub answer_text: String,
    pub score: ScoreData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiAnswerResponse {
    pub team_name: String,
    pub answers: Vec<String>,
    pub scores: HashMap<String, ScoreData>,
}

// === Question Data (tagged union with data) ===
// Note: responses are stored as Vec to preserve submission order (first to last)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum QuestionData {
    #[serde(rename_all = "camelCase")]
    Standard { responses: Vec<TeamResponse> },
    #[serde(rename_all = "camelCase")]
    MultiAnswer { responses: Vec<MultiAnswerResponse> },
    #[serde(rename_all = "camelCase")]
    MultipleChoice {
        choices: Vec<String>,
        responses: Vec<TeamResponse>,
    },
}

impl QuestionData {
    pub fn has_responses(&self) -> bool {
        match self {
            QuestionData::Standard { responses } => !responses.is_empty(),
            QuestionData::MultiAnswer { responses } => !responses.is_empty(),
            QuestionData::MultipleChoice { responses, .. } => !responses.is_empty(),
        }
    }

    /// Filter question data to only include a specific team's response
    pub fn filter_for_team(&self, team_name: &str) -> TeamQuestionData {
        match self {
            QuestionData::Standard { responses } => TeamQuestionData::Standard {
                response: responses.iter().find(|r| r.team_name == team_name).cloned(),
            },
            QuestionData::MultiAnswer { responses } => TeamQuestionData::MultiAnswer {
                response: responses.iter().find(|r| r.team_name == team_name).cloned(),
            },
            QuestionData::MultipleChoice { choices, responses } => {
                TeamQuestionData::MultipleChoice {
                    choices: choices.clone(),
                    response: responses.iter().find(|r| r.team_name == team_name).cloned(),
                }
            }
        }
    }
}

// === Team Question Data (filtered for a single team) ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum TeamQuestionData {
    #[serde(rename_all = "camelCase")]
    Standard { response: Option<TeamResponse> },
    #[serde(rename_all = "camelCase")]
    MultiAnswer {
        response: Option<MultiAnswerResponse>,
    },
    #[serde(rename_all = "camelCase")]
    MultipleChoice {
        choices: Vec<String>,
        response: Option<TeamResponse>,
    },
}

// === Question ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub timer_duration: u32,
    pub question_points: u32,
    pub bonus_increment: u32,
    pub question_data: QuestionData,
}

// === Game Settings ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSettings {
    pub default_timer_duration: u32,
    pub default_question_points: u32,
    pub default_bonus_increment: u32,
    pub default_question_type: QuestionKind,
}

// === Team Types ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamColor {
    pub hex_code: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamData {
    pub team_name: String,
    pub team_members: Vec<String>,
    pub team_color: TeamColor,
    pub score: ScoreData,
    pub connected: bool,
}
