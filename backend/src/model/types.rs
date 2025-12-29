use serde::{Deserialize, Serialize};

// === Question Kind ===
// NOTE: When we implement MultipleChoice, this enum will need to carry
// question-level settings (e.g., `MultipleChoice { choices: Vec<String> }`).
// For now it's just a discriminant.

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

// === TeamQuestionResult ===
// Represents a team's state for a question, including their answer (if any) and score.
// - On the host side (Question.answers): only contains entries for teams that submitted,
//   so content is always present in practice.
// - On the team side (TeamGameState.questions): includes all historic questions,
//   so content may be None if the team didn't submit.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamQuestionResult {
    pub team_name: String,
    pub score: ScoreData,
    pub content: Option<AnswerContent>,
}

/// The content of a team's answer, varying by question type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AnswerContent {
    #[serde(rename_all = "camelCase")]
    Standard { answer_text: String },
    #[serde(rename_all = "camelCase")]
    MultiAnswer { answers: Vec<String> },
    #[serde(rename_all = "camelCase")]
    MultipleChoice { selected: String },
}

// === Question ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub timer_duration: u32,
    pub question_points: u32,
    pub bonus_increment: u32,
    pub question_kind: QuestionKind,
    pub answers: Vec<TeamQuestionResult>,
}

impl Question {
    /// Check if any team has submitted an answer
    pub fn has_answers(&self) -> bool {
        !self.answers.is_empty()
    }

    /// Filter question to only include a specific team's data
    pub fn filter_for_team(&self, team_name: &str) -> TeamQuestionResult {
        self.answers
            .iter()
            .find(|a| a.team_name == team_name)
            .cloned()
            .unwrap_or_else(|| TeamQuestionResult {
                team_name: team_name.to_string(),
                score: ScoreData::new(),
                content: None,
            })
    }
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
