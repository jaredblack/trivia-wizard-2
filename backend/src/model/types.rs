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

// === Answer Types ===
// An Answer represents a single team's submission for a question.
// Answers are stored in order of submission (first to last).

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub team_name: String,
    pub score: Option<ScoreData>,
    pub content: AnswerContent,
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

// === Team Question (filtered view for team clients) ===
// Contains only the team's own answer and score for a question.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamQuestion {
    pub score: Option<ScoreData>,
    pub answer: Option<AnswerContent>,
}

// === Question ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub timer_duration: u32,
    pub question_points: u32,
    pub bonus_increment: u32,
    pub question_kind: QuestionKind,
    pub answers: Vec<Answer>,
}

impl Question {
    /// Check if any team has submitted an answer
    pub fn has_answers(&self) -> bool {
        !self.answers.is_empty()
    }

    /// Filter question to only include a specific team's data
    pub fn filter_for_team(&self, team_name: &str) -> TeamQuestion {
        let team_answer = self.answers.iter().find(|a| a.team_name == team_name);
        TeamQuestion {
            score: team_answer.and_then(|a| a.score.clone()),
            answer: team_answer.map(|a| a.content.clone()),
        }
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
