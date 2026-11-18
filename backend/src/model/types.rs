use serde::{Deserialize, Serialize};

// === Question Kind ===

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuestionKind {
    Standard,
    MultiAnswer,
    MultipleChoice,
    Numeric,
    Map,
}

// === Multiple Choice Configuration ===

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum McOptionType {
    Letters,
    Numbers,
    YesNo,
    TrueFalse,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McConfig {
    pub option_type: McOptionType,
    pub num_options: u32,
    pub custom_options: Option<Vec<String>>,
}

impl Default for McConfig {
    fn default() -> Self {
        Self {
            option_type: McOptionType::Letters,
            num_options: 4,
            custom_options: None,
        }
    }
}

// === Multi-Answer Configuration ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiAnswerConfig {
    pub num_answers: u32,
}

impl Default for MultiAnswerConfig {
    fn default() -> Self {
        Self { num_answers: 3 }
    }
}

// === Numeric Configuration ===

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NumericScoringMode {
    ExactOnly,
    Range,
    ClosestGuess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NumericRangeType {
    Absolute,
    Percent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RangeScoringType {
    #[default]
    Linear,
    Flat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumericConfig {
    pub scoring_mode: NumericScoringMode,
    pub range_type: NumericRangeType,
    pub range_value: f64,
    pub num_winners: u32,
    #[serde(default)]
    pub range_scoring_type: RangeScoringType,
}

impl Default for NumericConfig {
    fn default() -> Self {
        Self {
            scoring_mode: NumericScoringMode::ExactOnly,
            range_type: NumericRangeType::Absolute,
            range_value: 5.0,
            num_winners: 3,
            range_scoring_type: RangeScoringType::Linear,
        }
    }
}

// === Map Configuration ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapConfig {
    pub full_points_distance_km: f64,
    pub one_point_distance_km: f64,
}

impl Default for MapConfig {
    fn default() -> Self {
        Self {
            full_points_distance_km: 0.025, // 25 meters
            one_point_distance_km: 10000.0,
        }
    }
}

// === Question Config (discriminated union by question kind) ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum QuestionConfig {
    Standard,
    MultiAnswer {
        #[serde(flatten)]
        config: MultiAnswerConfig,
    },
    MultipleChoice {
        #[serde(flatten)]
        config: McConfig,
    },
    Numeric {
        #[serde(flatten)]
        config: NumericConfig,
    },
    Map {
        #[serde(flatten)]
        config: MapConfig,
    },
}

impl QuestionConfig {
    pub fn kind(&self) -> QuestionKind {
        match self {
            QuestionConfig::Standard => QuestionKind::Standard,
            QuestionConfig::MultiAnswer { .. } => QuestionKind::MultiAnswer,
            QuestionConfig::MultipleChoice { .. } => QuestionKind::MultipleChoice,
            QuestionConfig::Numeric { .. } => QuestionKind::Numeric,
            QuestionConfig::Map { .. } => QuestionKind::Map,
        }
    }
}

// === Score Types ===

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreData {
    pub question_points: i32,
    pub bonus_points: i32,
    pub override_points: i32,
    pub speed_bonus_points: i32,
}

impl ScoreData {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_score(&self) -> i32 {
        self.question_points + self.bonus_points + self.override_points + self.speed_bonus_points
    }
}

// === Answer ===
// Lean struct used in Question.answers (host view). The parent Question already has
// questionConfig, so we don't repeat it here.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub team_name: String,
    pub score: ScoreData,
    pub content: Option<AnswerContent>,
}

impl Answer {
    /// Check if this team's answer qualifies for speed bonus.
    /// For multi-answer: all sub-answers must be correct.
    /// For other types: question_points > 0 (i.e., marked correct).
    pub fn is_speed_bonus_eligible(&self) -> bool {
        match &self.content {
            Some(AnswerContent::Multi { correct, .. }) => {
                !correct.is_empty() && correct.iter().all(|&c| c)
            }
            _ => self.score.question_points > 0,
        }
    }
}

// === TeamQuestion ===
// Represents a team's per-question view (team side). Includes questionConfig because
// there is no parent Question in TeamGameState.questions.
// - On the team side (TeamGameState.questions): includes all historic questions,
//   so content may be None if the team didn't submit.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamQuestion {
    pub team_name: String,
    pub score: ScoreData,
    pub content: Option<AnswerContent>,
    pub question_config: QuestionConfig,
}

/// The content of a team's answer, varying by answer shape (not question type).
/// Single covers Standard and MultipleChoice questions (both hold one string).
/// Multi covers MultiAnswer questions (array of strings with correctness flags).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AnswerContent {
    #[serde(rename_all = "camelCase")]
    Single { answer_text: String },
    #[serde(rename_all = "camelCase")]
    Multi {
        answers: Vec<String>,
        #[serde(default)]
        correct: Vec<bool>,
    },
    #[serde(rename_all = "camelCase")]
    Coordinates { lat: f64, lng: f64 },
}

/// Flexible answer payload: a single string or an array of strings.
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AnswerSubmission {
    Single(String),
    Multi(Vec<String>),
    Coordinates { lat: f64, lng: f64 },
}

// === Question ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub timer_duration: u32,
    pub question_points: u32,
    pub bonus_increment: u32,
    pub question_config: QuestionConfig,
    pub answers: Vec<Answer>,
    pub speed_bonus_enabled: bool,
    #[serde(default)]
    pub multi_answer_correct_set: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub numeric_correct_answer: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_correct_location: Option<(f64, f64)>,
    /// Accepted answers for Standard / MultipleChoice questions, normalized with
    /// `normalize_answer_key`. A submission that matches one is scored correct on
    /// arrival. Comes from the attached deck; empty otherwise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub answer_key: Vec<String>,
}

/// Normalize text for comparison against a question's answer key: lowercase,
/// punctuation dropped, whitespace collapsed. "St. Louis!" and "st louis" match.
pub fn normalize_answer_key(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

// === Deck presets ===

/// What an attached deck says about one question. Every field is optional:
/// anything left out falls back to the game's defaults when the question is
/// created, exactly as if no deck were attached.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuestionPreset {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timer_duration: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question_points: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bonus_increment: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_bonus_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<QuestionKind>,

    // Type-specific settings; only those matching the question's kind are used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_answers: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option_type: Option<McOptionType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_options: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scoring_mode: Option<NumericScoringMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range_type: Option<NumericRangeType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_winners: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range_scoring_type: Option<RangeScoringType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_points_distance_km: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub one_point_distance_km: Option<f64>,

    // Answer keys.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub answer_key: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub multi_answer_correct_set: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub numeric_correct_answer: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_correct_location: Option<(f64, f64)>,
}

/// The deck attached to a game: which event it is, and one preset per question
/// in deck order.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckState {
    pub uuid: String,
    #[serde(default)]
    pub presets: Vec<QuestionPreset>,
    /// Which slide the projector shows: an index into the deck's slides, with
    /// the generated title slide at 0.
    #[serde(default)]
    pub slide_index: usize,
    /// Whether that slide's answer has been revealed.
    #[serde(default)]
    pub revealed: bool,
    /// Goes up each time the deck is (re)loaded, so displays know to re-read it.
    #[serde(default)]
    pub version: u32,
}

// Every outgoing message is logged with `{:?}`; a deck's presets (answer keys
// included) would be repeated in full each time, so only their count is shown.
impl std::fmt::Debug for DeckState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeckState")
            .field("uuid", &self.uuid)
            .field("presets", &format_args!("[{} presets]", self.presets.len()))
            .field("slide_index", &self.slide_index)
            .field("revealed", &self.revealed)
            .field("version", &self.version)
            .finish()
    }
}

/// Where the slides are, as told to watchers (the slides window is one).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckCursor {
    pub uuid: String,
    pub slide_index: usize,
    pub revealed: bool,
    pub version: u32,
}

impl Question {
    /// Check if any team has submitted an answer
    pub fn has_answers(&self) -> bool {
        !self.answers.is_empty()
    }

    /// Check if any team's answer has been scored (question_points > 0 or bonus_points > 0)
    pub fn has_scored_answers(&self) -> bool {
        self.answers
            .iter()
            .any(|a| a.score.question_points > 0 || a.score.bonus_points > 0)
    }

    /// Filter question to only include a specific team's data
    pub fn filter_for_team(&self, team_name: &str) -> TeamQuestion {
        match self
            .answers
            .iter()
            .find(|a| a.team_name.eq_ignore_ascii_case(team_name))
        {
            Some(a) => TeamQuestion {
                team_name: a.team_name.clone(),
                score: a.score.clone(),
                content: a.content.clone(),
                question_config: self.question_config.clone(),
            },
            None => TeamQuestion {
                team_name: team_name.to_string(),
                score: ScoreData::new(),
                content: None,
                question_config: self.question_config.clone(),
            },
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
    pub default_mc_config: McConfig,
    #[serde(default)]
    pub default_multi_answer_config: MultiAnswerConfig,
    #[serde(default)]
    pub default_numeric_config: NumericConfig,
    #[serde(default)]
    pub default_map_config: MapConfig,
    pub speed_bonus_enabled: bool,
    pub speed_bonus_num_teams: u32,
    pub speed_bonus_first_place_points: u32,
}

impl GameSettings {
    /// Build the QuestionConfig corresponding to the current default question type.
    pub fn default_question_config(&self) -> QuestionConfig {
        self.config_for_kind(self.default_question_type)
    }

    /// Build the default QuestionConfig for a given kind.
    pub fn config_for_kind(&self, kind: QuestionKind) -> QuestionConfig {
        match kind {
            QuestionKind::Standard => QuestionConfig::Standard,
            QuestionKind::MultiAnswer => QuestionConfig::MultiAnswer {
                config: self.default_multi_answer_config.clone(),
            },
            QuestionKind::MultipleChoice => QuestionConfig::MultipleChoice {
                config: self.default_mc_config.clone(),
            },
            QuestionKind::Numeric => QuestionConfig::Numeric {
                config: self.default_numeric_config.clone(),
            },
            QuestionKind::Map => QuestionConfig::Map {
                config: self.default_map_config.clone(),
            },
        }
    }
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

// === Scoreboard Data (for watchers) ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreboardData {
    pub teams: Vec<TeamData>,
    pub timer_running: bool,
    pub timer_seconds_remaining: Option<u32>,
    #[serde(default)]
    pub current_question_number: usize,
    /// How many teams have answered the current question.
    #[serde(default)]
    pub answers_received: usize,
    /// Present only when a deck is attached.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deck: Option<DeckCursor>,
}
