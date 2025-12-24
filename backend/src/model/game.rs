use crate::model::server_message::{GameState, ServerMessage, TeamGameState, send_msg};
use crate::model::types::{
    GameSettings, Question, QuestionData, QuestionKind, ScoreData, TeamColor, TeamData,
    TeamResponse,
};
use crate::server::Tx;
use std::collections::HashMap;
use tokio::task::AbortHandle;

/// Hardcoded game settings for this iteration
const DEFAULT_TIMER_DURATION: u32 = 30;
const DEFAULT_QUESTION_POINTS: u32 = 50;
const DEFAULT_BONUS_INCREMENT: u32 = 5;

pub struct Game {
    // Connection channels
    pub game_code: String,
    pub host_tx: Option<Tx>,
    pub teams_tx: HashMap<String, Tx>,

    // Game state
    pub current_question_number: usize,
    pub timer_running: bool,
    pub timer_seconds_remaining: Option<u32>,
    pub teams: Vec<TeamData>,
    pub questions: Vec<Question>,
    pub game_settings: GameSettings,

    // Timer task handle for cancellation
    pub timer_abort_handle: Option<AbortHandle>,
}

impl Game {
    pub fn new(game_code: String, host_tx: Tx) -> Self {
        let game_settings = GameSettings {
            default_timer_duration: DEFAULT_TIMER_DURATION,
            default_question_points: DEFAULT_QUESTION_POINTS,
            default_bonus_increment: DEFAULT_BONUS_INCREMENT,
            default_question_type: QuestionKind::Standard,
        };

        // Initialize with one empty standard question
        let initial_question = Question {
            timer_duration: DEFAULT_TIMER_DURATION,
            question_points: DEFAULT_QUESTION_POINTS,
            bonus_increment: DEFAULT_BONUS_INCREMENT,
            question_data: QuestionData::Standard { responses: vec![] },
        };

        Self {
            game_code,
            host_tx: Some(host_tx),
            teams_tx: HashMap::new(),
            current_question_number: 1,
            timer_running: false,
            timer_seconds_remaining: Some(DEFAULT_TIMER_DURATION),
            teams: vec![],
            questions: vec![initial_question],
            game_settings,
            timer_abort_handle: None,
        }
    }

    pub fn set_host_tx(&mut self, host_tx: Tx) {
        self.host_tx = Some(host_tx);
    }

    pub fn clear_host_tx(&mut self) {
        self.host_tx = None;
    }

    pub fn add_team(
        &mut self,
        team_name: String,
        team_tx: Tx,
        team_color: TeamColor,
        team_members: Vec<String>,
    ) {
        // Add to connection tracking
        self.teams_tx.insert(team_name.clone(), team_tx);

        // Add to game state with zeroed score
        self.teams.push(TeamData {
            team_name,
            team_members,
            team_color,
            score: ScoreData::new(),
            connected: true,
        });
    }

    pub fn current_question(&self) -> &Question {
        &self.questions[self.current_question_number - 1]
    }

    pub fn current_question_mut(&mut self) -> &mut Question {
        &mut self.questions[self.current_question_number - 1]
    }

    /// Convert to the wire format for host clients
    pub fn to_game_state(&self) -> GameState {
        GameState {
            game_code: self.game_code.clone(),
            current_question_number: self.current_question_number,
            timer_running: self.timer_running,
            timer_seconds_remaining: self.timer_seconds_remaining,
            teams: self.teams.clone(),
            questions: self.questions.clone(),
            game_settings: self.game_settings.clone(),
        }
    }

    /// Convert to the filtered wire format for team clients
    pub fn to_team_game_state(&self, team_name: &str) -> Option<TeamGameState> {
        let team = self.teams.iter().find(|t| t.team_name == team_name)?;
        let current_q = self.current_question();

        Some(TeamGameState {
            game_code: self.game_code.clone(),
            current_question_number: self.current_question_number,
            timer_running: self.timer_running,
            timer_seconds_remaining: self.timer_seconds_remaining,
            team: team.clone(),
            current_question_kind: self.game_settings.default_question_type,
            current_question_choices: match &current_q.question_data {
                QuestionData::MultipleChoice { choices, .. } => Some(choices.clone()),
                _ => None,
            },
        })
    }

    /// Broadcast full GameState to host and TeamGameState to all teams
    pub fn broadcast_game_state(&self) {
        // Send full GameState to host
        if let Some(host_tx) = &self.host_tx {
            send_msg(
                host_tx,
                ServerMessage::GameState {
                    state: self.to_game_state(),
                },
            );
        }

        // Send filtered TeamGameState to each team
        for (team_name, team_tx) in &self.teams_tx {
            if let Some(team_state) = self.to_team_game_state(team_name) {
                send_msg(team_tx, ServerMessage::TeamGameState { state: team_state });
            }
        }
    }

    // === Answer submission ===

    /// Add an answer to the current question. Returns false if team already submitted.
    pub fn add_answer(&mut self, team_name: &str, answer_text: String) -> bool {
        let question = self.current_question_mut();
        let responses = match &mut question.question_data {
            QuestionData::Standard { responses } => responses,
            QuestionData::MultipleChoice { responses, .. } => responses,
            QuestionData::MultiAnswer { .. } => return false, // Not supported yet
        };

        // Check if team already submitted
        if responses.iter().any(|r| r.team_name == team_name) {
            return false;
        }

        responses.push(TeamResponse {
            team_name: team_name.to_string(),
            answer_text,
            score: ScoreData::new(),
        });

        true
    }

    // === Scoring operations ===

    /// Score a team's answer for a specific question. Returns true if successful.
    pub fn score_answer(
        &mut self,
        question_number: usize,
        team_name: &str,
        score: ScoreData,
    ) -> bool {
        let question_idx = question_number - 1;
        if question_idx >= self.questions.len() {
            return false;
        }

        let question = &mut self.questions[question_idx];
        let responses = match &mut question.question_data {
            QuestionData::Standard { responses } => responses,
            QuestionData::MultipleChoice { responses, .. } => responses,
            QuestionData::MultiAnswer { .. } => return false,
        };

        if let Some(response) = responses.iter_mut().find(|r| r.team_name == team_name) {
            response.score = score;
            self.recalculate_team_score(team_name);
            true
        } else {
            false
        }
    }

    /// Clear a team's answer score for a specific question. Returns true if successful.
    pub fn clear_answer_score(&mut self, question_number: usize, team_name: &str) -> bool {
        self.score_answer(question_number, team_name, ScoreData::new())
    }

    /// Override a team's total score with additional points
    pub fn override_team_score(&mut self, team_name: &str, override_points: i32) -> bool {
        if let Some(team) = self.teams.iter_mut().find(|t| t.team_name == team_name) {
            team.score.override_points = override_points;
            true
        } else {
            false
        }
    }

    /// Recalculate a team's cumulative score from all question responses
    fn recalculate_team_score(&mut self, team_name: &str) {
        let mut total_question_points = 0i32;
        let mut total_bonus_points = 0i32;

        for question in &self.questions {
            let responses = match &question.question_data {
                QuestionData::Standard { responses } => responses,
                QuestionData::MultipleChoice { responses, .. } => responses,
                QuestionData::MultiAnswer { .. } => continue,
            };

            if let Some(response) = responses.iter().find(|r| r.team_name == team_name) {
                total_question_points += response.score.question_points;
                total_bonus_points += response.score.bonus_points;
            }
        }

        if let Some(team) = self.teams.iter_mut().find(|t| t.team_name == team_name) {
            team.score.question_points = total_question_points;
            team.score.bonus_points = total_bonus_points;
            // override_points is preserved (not recalculated)
        }
    }

    // === Team connection status ===

    /// Set a team's connected status
    pub fn set_team_connected(&mut self, team_name: &str, connected: bool) -> bool {
        if let Some(team) = self.teams.iter_mut().find(|t| t.team_name == team_name) {
            team.connected = connected;
            true
        } else {
            false
        }
    }
}
