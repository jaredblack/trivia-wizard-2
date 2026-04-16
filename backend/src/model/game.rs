use crate::game_timer::pause_timer;
use crate::model::server_message::{GameState, ServerMessage, TeamGameState, send_msg};
use crate::model::types::{
    Answer, AnswerContent, AnswerSubmission, GameSettings, MapConfig, McConfig, MultiAnswerConfig,
    NumericConfig, NumericRangeType, NumericScoringMode, Question, QuestionConfig, QuestionKind,
    RangeScoringType, ScoreData, ScoreboardData, TeamColor, TeamData,
};
use crate::server::Tx;
use anyhow::{Result, anyhow};
use std::collections::HashMap;
use tokio::task::AbortHandle;

/// Extract and normalize answer text for comparison (trimmed, lowercase).
/// Returns None for MultiAnswer or missing content.
fn normalize_answer_text(content: &Option<AnswerContent>) -> Option<String> {
    match content {
        Some(AnswerContent::Single { answer_text }) => Some(answer_text.trim().to_lowercase()),
        _ => None,
    }
}

/// Normalize a string for multi-answer comparison (trimmed, lowercase).
fn normalize_multi_answer(s: &str) -> String {
    s.trim().to_lowercase()
}

/// Grade a team's multi-answer submission against the correct set.
/// Uses cardinality-aware greedy matching: each correct answer text can only match once.
/// Empty strings are always marked incorrect.
fn grade_multi_answer(answers: &[String], correct_set: &[String]) -> Vec<bool> {
    let mut remaining: Vec<String> = correct_set.to_vec();
    let mut result = Vec::with_capacity(answers.len());

    for answer in answers {
        let normalized = normalize_multi_answer(answer);
        if normalized.is_empty() {
            result.push(false);
            continue;
        }
        if let Some(pos) = remaining.iter().position(|c| *c == normalized) {
            remaining.remove(pos);
            result.push(true);
        } else {
            result.push(false);
        }
    }

    result
}

/// Calculate question points for a multi-answer submission.
/// floor(base_points / num_answers) * num_correct
fn calculate_multi_answer_question_points(
    correct: &[bool],
    base_points: u32,
    num_answers: u32,
) -> i32 {
    let per_answer = base_points as i32 / num_answers as i32;
    let num_correct = correct.iter().filter(|&&c| c).count() as i32;
    per_answer * num_correct
}

// === Numeric Scoring Functions ===

/// Calculate score for exact-only numeric mode.
fn calculate_numeric_score_exact(answer: f64, correct: f64, base_points: u32) -> i32 {
    if answer == correct {
        base_points as i32
    } else {
        0
    }
}

/// Calculate score for range numeric mode.
/// Linear: points decrease linearly from full to 1 across the range.
/// Flat: full points for any answer within range, 0 outside.
fn calculate_numeric_score_range(
    answer: f64,
    correct: f64,
    base_points: u32,
    range_type: NumericRangeType,
    range_value: f64,
    range_scoring_type: RangeScoringType,
) -> i32 {
    let max_distance = match range_type {
        NumericRangeType::Absolute => range_value,
        NumericRangeType::Percent => correct.abs() * range_value / 100.0,
    };

    // If max_distance is 0, fall back to exact-only behavior
    if max_distance == 0.0 {
        return calculate_numeric_score_exact(answer, correct, base_points);
    }

    let distance = (answer - correct).abs();
    if distance > max_distance {
        return 0;
    }

    match range_scoring_type {
        RangeScoringType::Flat => base_points as i32,
        RangeScoringType::Linear => {
            let score =
                ((base_points as f64) * (max_distance - distance) / max_distance).floor() as i32;
            // Guarantee at least 1 point for answers within range (inclusive)
            score.max(1)
        }
    }
}

/// Calculate scores for closest-guess numeric mode.
/// Returns a map of team_name -> question_points.
fn calculate_numeric_score_closest_guess(
    answers: &[Answer],
    correct: f64,
    base_points: u32,
    num_winners: u32,
) -> HashMap<String, i32> {
    let mut result = HashMap::new();

    // Parse each team's answer and compute distance
    let mut team_distances: Vec<(String, f64)> = Vec::new();
    for tq in answers {
        if let Some(AnswerContent::Single { answer_text }) = &tq.content {
            if let Ok(val) = answer_text.trim().parse::<f64>() {
                team_distances.push((tq.team_name.clone(), (val - correct).abs()));
            }
        }
    }

    if team_distances.is_empty() {
        return result;
    }

    // Sort by distance
    team_distances.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    // Group by distance, walk through groups
    let mut teams_awarded = 0u32;
    let mut current_points = base_points as f64;
    let mut i = 0;

    while i < team_distances.len() && teams_awarded < num_winners {
        // Collect all teams at this distance
        let current_distance = team_distances[i].1;
        let mut group = Vec::new();
        while i < team_distances.len() && team_distances[i].1 == current_distance {
            group.push(team_distances[i].0.clone());
            i += 1;
        }

        let points = current_points.floor() as i32;
        for team_name in &group {
            result.insert(team_name.clone(), points);
        }
        teams_awarded += group.len() as u32;
        current_points = (current_points / 2.0).floor();
    }

    result
}

// === Map Scoring Functions ===

/// Calculate the great-circle distance between two points using the Haversine formula.
/// Returns distance in kilometers.
fn haversine_distance_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    const EARTH_RADIUS_KM: f64 = 6371.0;

    let lat1_rad = lat1.to_radians();
    let lat2_rad = lat2.to_radians();
    let dlat = (lat2 - lat1).to_radians();
    let dlng = (lng2 - lng1).to_radians();

    let a =
        (dlat / 2.0).sin().powi(2) + lat1_rad.cos() * lat2_rad.cos() * (dlng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().asin();

    EARTH_RADIUS_KM * c
}

/// Calculate score for a map question using GeoGuessr-style exponential decay.
/// score = base_points * e^(-10 * distance / zero_points_distance)
/// Full points if within full_points_distance.
fn calculate_map_score(distance_km: f64, base_points: u32, config: &MapConfig) -> i32 {
    if distance_km <= config.full_points_distance_km {
        return base_points as i32;
    }
    let score = (base_points as f64) * (-10.0 * distance_km / config.zero_points_distance_km).exp();
    (score.floor() as i32).max(0)
}

/// Hardcoded game settings for this iteration
const DEFAULT_TIMER_DURATION: u32 = 30;
const DEFAULT_QUESTION_POINTS: u32 = 50;
const DEFAULT_BONUS_INCREMENT: u32 = 5;
const DEFAULT_SPEED_BONUS_ENABLED: bool = false;
const DEFAULT_SPEED_BONUS_NUM_TEAMS: u32 = 2;
const DEFAULT_SPEED_BONUS_FIRST_PLACE_POINTS: u32 = 10;

pub struct Game {
    // Connection channels
    pub game_code: String,
    pub host_user_id: String,
    pub host_tx: Option<Tx>,
    pub teams_tx: HashMap<String, Tx>,
    pub watchers_tx: Vec<Tx>,

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
    pub fn new(game_code: String, host_tx: Tx, host_user_id: String) -> Self {
        let game_settings = GameSettings {
            default_timer_duration: DEFAULT_TIMER_DURATION,
            default_question_points: DEFAULT_QUESTION_POINTS,
            default_bonus_increment: DEFAULT_BONUS_INCREMENT,
            default_question_type: QuestionKind::Standard,
            default_mc_config: McConfig::default(),
            default_multi_answer_config: MultiAnswerConfig::default(),
            default_numeric_config: NumericConfig::default(),
            default_map_config: MapConfig::default(),
            speed_bonus_enabled: DEFAULT_SPEED_BONUS_ENABLED,
            speed_bonus_num_teams: DEFAULT_SPEED_BONUS_NUM_TEAMS,
            speed_bonus_first_place_points: DEFAULT_SPEED_BONUS_FIRST_PLACE_POINTS,
        };

        // Initialize with one empty standard question
        let initial_question = Question {
            timer_duration: DEFAULT_TIMER_DURATION,
            question_points: DEFAULT_QUESTION_POINTS,
            bonus_increment: DEFAULT_BONUS_INCREMENT,
            question_config: QuestionConfig::Standard,
            answers: vec![],
            speed_bonus_enabled: DEFAULT_SPEED_BONUS_ENABLED,
            multi_answer_correct_set: vec![],
            numeric_correct_answer: None,
            map_correct_location: None,
        };

        Self {
            game_code,
            host_user_id,
            host_tx: Some(host_tx),
            teams_tx: HashMap::new(),
            watchers_tx: Vec::new(),
            current_question_number: 1,
            timer_running: false,
            timer_seconds_remaining: Some(DEFAULT_TIMER_DURATION),
            teams: vec![],
            questions: vec![initial_question],
            game_settings,
            timer_abort_handle: None,
        }
    }

    /// Create a Game from a saved GameState (for S3 restoration).
    /// Sets up connection state (host_tx, empty teams_tx, no timer handle).
    /// All teams are marked as disconnected since they need to reconnect.
    pub fn from_saved_state(
        host_user_id: String,
        game_code: String,
        host_tx: Tx,
        state: GameState,
    ) -> Self {
        // Mark all teams as disconnected - they need to reconnect
        let teams = state
            .teams
            .into_iter()
            .map(|mut team| {
                team.connected = false;
                team
            })
            .collect();

        Self {
            game_code,
            host_user_id,
            host_tx: Some(host_tx),
            teams_tx: HashMap::new(),
            watchers_tx: Vec::new(),
            current_question_number: state.current_question_number,
            timer_running: false, // Always start with timer stopped on restore
            timer_seconds_remaining: state.timer_seconds_remaining,
            teams,
            questions: state.questions,
            game_settings: state.game_settings,
            timer_abort_handle: None,
        }
    }

    /// Find a team by name (case-insensitive)
    pub fn find_team(&self, team_name: &str) -> Option<&TeamData> {
        let name_lower = team_name.to_lowercase();
        self.teams
            .iter()
            .find(|t| t.team_name.to_lowercase() == name_lower)
    }

    /// Find a team by name (case-insensitive) with mutable access
    pub fn find_team_mut(&mut self, team_name: &str) -> Option<&mut TeamData> {
        let name_lower = team_name.to_lowercase();
        self.teams
            .iter_mut()
            .find(|t| t.team_name.to_lowercase() == name_lower)
    }

    pub fn set_host_tx(&mut self, host_tx: Tx) {
        self.host_tx = Some(host_tx);
    }

    pub fn clear_host_tx(&mut self) {
        self.host_tx = None;
    }

    pub fn clear_team_tx(&mut self, team_name: &str) {
        self.teams_tx.remove(&team_name.to_lowercase());
    }

    pub fn add_watcher(&mut self, watcher_tx: Tx) {
        self.watchers_tx.push(watcher_tx);
    }

    pub fn remove_watcher(&mut self, watcher_tx: &Tx) {
        self.watchers_tx.retain(|tx| !tx.same_channel(watcher_tx));
    }

    pub fn add_team(
        &mut self,
        team_name: String,
        team_tx: Tx,
        team_color: TeamColor,
        team_members: Vec<String>,
    ) {
        // Add to connection tracking
        self.teams_tx.insert(team_name.to_lowercase(), team_tx);

        // Check if team already exists (reconnection scenario)
        if let Some(team) = self.find_team_mut(&team_name) {
            // Team is reconnecting - preserve their score and update connection status
            team.connected = true;
            team.team_members = team_members;
            team.team_color = team_color;
        } else {
            // New team joining - add to game state with zeroed score
            self.teams.push(TeamData {
                team_name,
                team_members,
                team_color,
                score: ScoreData::new(),
                connected: true,
            });
        }
    }

    /// Rejoin an existing team - preserves color and members, just marks connected
    pub fn rejoin_team(&mut self, team_name: &str, team_tx: Tx) -> bool {
        // Check if team exists first
        if self.find_team(team_name).is_none() {
            return false;
        }
        self.teams_tx.insert(team_name.to_lowercase(), team_tx);
        // Safe to unwrap since we just checked existence
        self.find_team_mut(team_name).unwrap().connected = true;
        true
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
        let team = self.find_team(team_name)?;
        let questions: Vec<_> = self
            .questions
            .iter()
            .map(|q| q.filter_for_team(team_name))
            .collect();

        Some(TeamGameState {
            game_code: self.game_code.clone(),
            current_question_number: self.current_question_number,
            timer_running: self.timer_running,
            timer_seconds_remaining: self.timer_seconds_remaining,
            team: team.clone(),
            questions,
        })
    }

    /// Convert to scoreboard data for watcher clients
    pub fn to_scoreboard_data(&self) -> ScoreboardData {
        ScoreboardData {
            teams: self.teams.clone(),
            timer_running: self.timer_running,
            timer_seconds_remaining: self.timer_seconds_remaining,
        }
    }

    // === Question Navigation ===

    /// Create a new question using game settings
    fn create_question_from_settings(&self) -> Question {
        Question {
            timer_duration: self.game_settings.default_timer_duration,
            question_points: self.game_settings.default_question_points,
            bonus_increment: self.game_settings.default_bonus_increment,
            question_config: self.game_settings.default_question_config(),
            answers: vec![],
            speed_bonus_enabled: self.game_settings.speed_bonus_enabled,
            multi_answer_correct_set: vec![],
            numeric_correct_answer: None,
            map_correct_location: None,
        }
    }

    /// Stop the timer if running
    fn stop_timer(&mut self) {
        if let Some(handle) = self.timer_abort_handle.take() {
            handle.abort();
        }
        self.timer_running = false;
    }

    /// Navigate to the next question. Creates a new question if needed.
    pub fn next_question(&mut self) {
        // Stop timer if running
        self.stop_timer();

        // Increment question number
        self.current_question_number += 1;

        // Create new question if it doesn't exist
        if self.current_question_number > self.questions.len() {
            let new_question = self.create_question_from_settings();
            self.questions.push(new_question);
        }

        // Reset timer to new question's duration
        self.timer_seconds_remaining = Some(self.current_question().timer_duration);
    }

    /// Navigate to the previous question. Returns error if already at question 1.
    pub fn prev_question(&mut self) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.current_question_number > 1,
            "Already at first question"
        );

        // Stop timer if running
        self.stop_timer();

        // Decrement question number
        self.current_question_number -= 1;

        // Reset timer to new question's duration
        self.timer_seconds_remaining = Some(self.current_question().timer_duration);

        Ok(())
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

        // Send scoreboard data to all watchers
        self.broadcast_scoreboard_data();
    }

    /// Broadcast scoreboard data to all watchers
    pub fn broadcast_scoreboard_data(&self) {
        let scoreboard_msg = ServerMessage::ScoreboardData {
            data: self.to_scoreboard_data(),
        };
        for watcher_tx in &self.watchers_tx {
            send_msg(watcher_tx, scoreboard_msg.clone());
        }
    }

    // === Answer submission ===

    /// Submit an answer to the current question. Returns false if team already submitted
    /// or the submission type doesn't match the question type.
    ///
    /// For single-answer questions (Standard, MultipleChoice): expects `AnswerSubmission::Single`.
    ///   If the answer matches an existing scored-correct answer (case-insensitive, trimmed),
    ///   the new answer is automatically scored correct as well.
    ///
    /// For multi-answer questions: expects `AnswerSubmission::Multi`.
    ///   Grades against the current correct set and auto-scores.
    pub fn submit_answer(&mut self, team_name: &str, submission: AnswerSubmission) -> bool {
        let question = self.current_question_mut();

        // Check if team already submitted
        if question
            .answers
            .iter()
            .any(|a| a.team_name.eq_ignore_ascii_case(team_name))
        {
            return false;
        }

        let question_kind = question.question_config.kind();
        let is_multi_answer = question_kind == QuestionKind::MultiAnswer;
        let is_numeric = question_kind == QuestionKind::Numeric;
        let is_map = question_kind == QuestionKind::Map;

        let submitted = match (submission, is_multi_answer, is_numeric, is_map) {
            // Numeric question: validate as f64, auto-score
            (AnswerSubmission::Single(answer_text), false, true, false) => {
                // Validate that the answer is a valid number
                let parsed: f64 = match answer_text.trim().parse() {
                    Ok(v) => v,
                    Err(_) => return false, // Reject non-numeric submissions
                };

                let content = AnswerContent::Single {
                    answer_text: answer_text.clone(),
                };

                // Auto-calculate question_points if correct answer is set
                let mut new_score = ScoreData::new();
                if let Some(correct) = question.numeric_correct_answer {
                    let config = match &question.question_config {
                        QuestionConfig::Numeric { config } => config.clone(),
                        _ => NumericConfig::default(),
                    };
                    let base_points = question.question_points;

                    match config.scoring_mode {
                        NumericScoringMode::ExactOnly => {
                            new_score.question_points =
                                calculate_numeric_score_exact(parsed, correct, base_points);
                        }
                        NumericScoringMode::Range => {
                            new_score.question_points = calculate_numeric_score_range(
                                parsed,
                                correct,
                                base_points,
                                config.range_type,
                                config.range_value,
                                config.range_scoring_type,
                            );
                        }
                        NumericScoringMode::ClosestGuess => {
                            // For closest guess, we need to score after adding this answer.
                            // Will be handled by recalculate below.
                        }
                    }
                }

                question.answers.push(Answer {
                    team_name: team_name.to_string(),
                    score: new_score,
                    content: Some(content),
                });

                // Recalculate scores if correct answer is set
                let question_idx = self.current_question_number - 1;
                if self.questions[question_idx]
                    .numeric_correct_answer
                    .is_some()
                {
                    let config = match &self.questions[question_idx].question_config {
                        QuestionConfig::Numeric { config } => config.clone(),
                        _ => NumericConfig::default(),
                    };
                    if config.scoring_mode == NumericScoringMode::ClosestGuess {
                        // For closest guess, recalculate ALL teams since rankings change
                        self.recalculate_numeric_scores(question_idx);
                        let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
                        let all_team_names: Vec<String> = self.questions[question_idx]
                            .answers
                            .iter()
                            .map(|a| a.team_name.clone())
                            .collect();
                        for team in all_team_names {
                            self.recalculate_team_score(&team);
                        }
                        for team in speed_bonus_teams {
                            self.recalculate_team_score(&team);
                        }
                    } else if self.questions[question_idx]
                        .answers
                        .last()
                        .map_or(false, |a| a.score.question_points > 0)
                    {
                        let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
                        self.recalculate_team_score(team_name);
                        for team in speed_bonus_teams {
                            if team != team_name {
                                self.recalculate_team_score(&team);
                            }
                        }
                    }
                }

                true
            }

            // Single-answer submission for Standard/MultipleChoice question
            (AnswerSubmission::Single(answer_text), false, false, false) => {
                let content = AnswerContent::Single {
                    answer_text: answer_text.clone(),
                };

                // Check if this answer matches any already-scored-correct answer
                let question_base_points = question.question_points as i32;
                let normalized_new = answer_text.trim().to_lowercase();

                let auto_score = question.answers.iter().find_map(|existing| {
                    if existing.score.question_points == question_base_points {
                        if let Some(existing_text) = normalize_answer_text(&existing.content) {
                            if existing_text == normalized_new {
                                return Some((question_base_points, existing.score.bonus_points));
                            }
                        }
                    }
                    None
                });

                let mut new_score = ScoreData::new();
                if let Some((question_points, bonus_points)) = auto_score {
                    new_score.question_points = question_points;
                    new_score.bonus_points = bonus_points;
                }

                question.answers.push(Answer {
                    team_name: team_name.to_string(),
                    score: new_score,
                    content: Some(content),
                });

                // If auto-scored, recalculate speed bonuses and team scores
                if auto_score.is_some() {
                    let question_idx = self.current_question_number - 1;
                    let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
                    self.recalculate_team_score(team_name);
                    for team in speed_bonus_teams {
                        if team != team_name {
                            self.recalculate_team_score(&team);
                        }
                    }
                }

                true
            }

            // Multi-answer submission for MultiAnswer question
            (AnswerSubmission::Multi(answers), true, _, _) => {
                // Grade against current correct set
                let correct = grade_multi_answer(&answers, &question.multi_answer_correct_set);

                // Get num_answers from config
                let num_answers = match &question.question_config {
                    QuestionConfig::MultiAnswer { config } => config.num_answers,
                    _ => answers.len() as u32,
                };

                let question_points = calculate_multi_answer_question_points(
                    &correct,
                    question.question_points,
                    num_answers,
                );

                let score = ScoreData {
                    question_points,
                    ..ScoreData::new()
                };

                question.answers.push(Answer {
                    team_name: team_name.to_string(),
                    score,
                    content: Some(AnswerContent::Multi { answers, correct }),
                });

                // Recalculate speed bonuses and team scores if auto-scored
                if question_points > 0 {
                    let question_idx = self.current_question_number - 1;
                    let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
                    self.recalculate_team_score(team_name);
                    for team in speed_bonus_teams {
                        if team != team_name {
                            self.recalculate_team_score(&team);
                        }
                    }
                }

                true
            }

            // Map question: validate coordinates, auto-score
            (AnswerSubmission::Coordinates { lat, lng }, false, false, true) => {
                // Validate coordinate ranges
                if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lng) {
                    return false;
                }

                let content = AnswerContent::Coordinates { lat, lng };

                // Auto-calculate question_points if correct location is set
                let mut new_score = ScoreData::new();
                if let Some((correct_lat, correct_lng)) = question.map_correct_location {
                    let config = match &question.question_config {
                        QuestionConfig::Map { config } => config.clone(),
                        _ => MapConfig::default(),
                    };
                    let distance = haversine_distance_km(lat, lng, correct_lat, correct_lng);
                    new_score.question_points =
                        calculate_map_score(distance, question.question_points, &config);
                }

                question.answers.push(Answer {
                    team_name: team_name.to_string(),
                    score: new_score,
                    content: Some(content),
                });

                // Recalculate speed bonuses and team scores if auto-scored
                let question_idx = self.current_question_number - 1;
                if self.questions[question_idx].map_correct_location.is_some() {
                    let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
                    self.recalculate_team_score(team_name);
                    for team in speed_bonus_teams {
                        if team != team_name {
                            self.recalculate_team_score(&team);
                        }
                    }
                }

                true
            }

            // Submission type doesn't match question type
            _ => false,
        };

        // Auto-pause timer once all teams have submitted
        if submitted {
            let answers_count = self.questions[self.current_question_number - 1]
                .answers
                .len();
            if answers_count >= self.teams.len() {
                pause_timer(self);
            }
        }

        submitted
    }

    /// Toggle a sub-answer's correctness for a multi-answer question.
    /// This adds/removes the text from the global correct set and re-grades ALL teams.
    pub fn toggle_multi_answer_correctness(
        &mut self,
        question_number: usize,
        team_name: &str,
        sub_answer_index: usize,
    ) -> bool {
        let question_idx = question_number - 1;
        if question_idx >= self.questions.len() {
            return false;
        }

        // Get the text at the sub-answer index for this team
        let question = &self.questions[question_idx];
        let answer = question
            .answers
            .iter()
            .find(|a| a.team_name.eq_ignore_ascii_case(team_name));
        let Some(answer) = answer else {
            return false;
        };
        let Some(AnswerContent::Multi {
            answers, correct, ..
        }) = &answer.content
        else {
            return false;
        };
        if sub_answer_index >= answers.len() {
            return false;
        }
        let text = normalize_multi_answer(&answers[sub_answer_index]);
        if text.is_empty() {
            return false; // Can't toggle empty answers
        }
        let is_currently_correct = correct.get(sub_answer_index).copied().unwrap_or(false);

        // Toggle in the correct set based on the clicked pill's current state
        let question = &mut self.questions[question_idx];
        if is_currently_correct {
            // Pill is correct -> remove one copy of this text from correct set
            if let Some(pos) = question
                .multi_answer_correct_set
                .iter()
                .position(|c| *c == text)
            {
                question.multi_answer_correct_set.remove(pos);
            }
        } else {
            // Pill is incorrect -> add this text to correct set
            question.multi_answer_correct_set.push(text);
        }

        // Re-grade ALL teams against updated correct set
        let correct_set = question.multi_answer_correct_set.clone();
        let base_points = question.question_points;
        let num_answers = match &question.question_config {
            QuestionConfig::MultiAnswer { config } => config.num_answers,
            _ => 3, // fallback
        };

        let mut teams_to_update: Vec<String> = Vec::new();

        for answer in &mut question.answers {
            if let Some(AnswerContent::Multi {
                answers, correct, ..
            }) = &mut answer.content
            {
                let new_correct = grade_multi_answer(answers, &correct_set);
                let new_question_points =
                    calculate_multi_answer_question_points(&new_correct, base_points, num_answers);
                *correct = new_correct;
                answer.score.question_points = new_question_points;
                teams_to_update.push(answer.team_name.clone());
            }
        }

        // Recalculate speed bonuses
        let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
        for t in speed_bonus_teams {
            if !teams_to_update.contains(&t) {
                teams_to_update.push(t);
            }
        }

        // Recalculate cumulative scores for all affected teams
        for team in &teams_to_update {
            self.recalculate_team_score(team);
        }

        true
    }

    // === Scoring operations ===

    /// Score a team's answer for a specific question. Returns true if successful.
    /// When scoring an answer as correct (full question points), automatically scores
    /// any other matching answers (case-insensitive, trimmed) as correct too.
    /// When clearing a score (setting to 0), clears all matching answers as well.
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

        // Find the target answer's index
        let Some(answer_idx) = question
            .answers
            .iter()
            .position(|a| a.team_name.eq_ignore_ascii_case(team_name))
        else {
            return false;
        };

        // For multi-answer and numeric questions, only update bonus_points and override_points.
        // question_points is derived from the correct set / numeric scoring, speed_bonus_points is recalculated.
        let answer_kind = question.question_config.kind();
        if answer_kind == QuestionKind::MultiAnswer || answer_kind == QuestionKind::Numeric {
            question.answers[answer_idx].score.bonus_points = score.bonus_points;
            question.answers[answer_idx].score.override_points = score.override_points;

            let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
            let mut teams_to_update = vec![team_name.to_string()];
            for t in speed_bonus_teams {
                if !teams_to_update.contains(&t) {
                    teams_to_update.push(t);
                }
            }
            for team in teams_to_update {
                self.recalculate_team_score(&team);
            }
            return true;
        }

        // Update the target answer's score (preserve speed_bonus_points, will be recalculated)
        let current_speed_bonus = question.answers[answer_idx].score.speed_bonus_points;
        question.answers[answer_idx].score = ScoreData {
            speed_bonus_points: current_speed_bonus,
            ..score.clone()
        };

        // Get normalized text for matching
        let Some(normalized_text) = normalize_answer_text(&question.answers[answer_idx].content)
        else {
            // Can't auto-score without text to match
            // Recalculate speed bonuses and team scores
            let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
            let mut teams_to_update = vec![team_name.to_string()];
            for t in speed_bonus_teams {
                if !teams_to_update.contains(&t) {
                    teams_to_update.push(t);
                }
            }
            for team in teams_to_update {
                self.recalculate_team_score(&team);
            }
            return true;
        };

        // Collect teams that need score recalculation
        let mut teams_to_update: Vec<String> = vec![team_name.to_string()];

        // Sync question_points and bonus_points to all matching answers
        let question = &mut self.questions[question_idx];
        for (i, other_answer) in question.answers.iter_mut().enumerate() {
            if i != answer_idx {
                if let Some(other_text) = normalize_answer_text(&other_answer.content) {
                    if other_text == normalized_text
                        && (other_answer.score.question_points != score.question_points
                            || other_answer.score.bonus_points != score.bonus_points)
                    {
                        other_answer.score.question_points = score.question_points;
                        other_answer.score.bonus_points = score.bonus_points;
                        teams_to_update.push(other_answer.team_name.clone());
                    }
                }
            }
        }

        // Recalculate speed bonuses
        let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
        for t in speed_bonus_teams {
            if !teams_to_update.contains(&t) {
                teams_to_update.push(t);
            }
        }

        // Recalculate scores for all affected teams
        for team in teams_to_update {
            self.recalculate_team_score(&team);
        }

        true
    }

    /// Clear a team's answer score for a specific question. Returns true if successful.
    pub fn clear_answer_score(&mut self, question_number: usize, team_name: &str) -> bool {
        self.score_answer(question_number, team_name, ScoreData::new())
    }

    /// Override a team's total score with additional points
    pub fn override_team_score(&mut self, team_name: &str, override_points: i32) -> bool {
        if let Some(team) = self.find_team_mut(team_name) {
            team.score.override_points = override_points;
            true
        } else {
            false
        }
    }

    /// Recalculate a team's cumulative score from all their answer scores
    fn recalculate_team_score(&mut self, team_name: &str) {
        let mut total_question_points = 0i32;
        let mut total_bonus_points = 0i32;
        let mut total_speed_bonus_points = 0i32;

        for question in &self.questions {
            if let Some(answer) = question
                .answers
                .iter()
                .find(|a| a.team_name.eq_ignore_ascii_case(team_name))
            {
                total_question_points += answer.score.question_points;
                total_bonus_points += answer.score.bonus_points;
                total_speed_bonus_points += answer.score.speed_bonus_points;
            }
        }

        if let Some(team) = self.find_team_mut(team_name) {
            team.score.question_points = total_question_points;
            team.score.bonus_points = total_bonus_points;
            team.score.speed_bonus_points = total_speed_bonus_points;
            // override_points is preserved (not recalculated)
        }
    }

    /// Calculate speed bonus points based on placement
    fn calculate_speed_bonus(place: usize, num_teams: u32, first_place_points: u32) -> i32 {
        if place >= num_teams as usize {
            return 0;
        }
        let remaining = num_teams as usize - place;
        (first_place_points as i32 * remaining as i32) / num_teams as i32
    }

    /// Recalculate speed bonuses for all answers in a question.
    /// Returns the list of team names whose scores changed.
    fn recalculate_speed_bonuses(&mut self, question_idx: usize) -> Vec<String> {
        let num_teams = self.game_settings.speed_bonus_num_teams;
        let first_place_points = self.game_settings.speed_bonus_first_place_points;

        let question = &mut self.questions[question_idx];
        let mut teams_changed = Vec::new();

        // If speed bonus is disabled for this question, clear all speed bonuses
        if !question.speed_bonus_enabled {
            for answer in &mut question.answers {
                if answer.score.speed_bonus_points != 0 {
                    answer.score.speed_bonus_points = 0;
                    teams_changed.push(answer.team_name.clone());
                }
            }
            return teams_changed;
        }

        // Count correct answers in submission order (answers are stored in submission order)
        let mut place = 0usize;
        for answer in &mut question.answers {
            let new_speed_bonus = if answer.is_speed_bonus_eligible() {
                let bonus = Self::calculate_speed_bonus(place, num_teams, first_place_points);
                place += 1;
                bonus
            } else {
                0
            };

            if answer.score.speed_bonus_points != new_speed_bonus {
                answer.score.speed_bonus_points = new_speed_bonus;
                teams_changed.push(answer.team_name.clone());
            }
        }

        teams_changed
    }

    // === Numeric scoring ===

    /// Set the correct answer for a numeric question and recalculate all scores.
    pub fn set_numeric_correct_answer(
        &mut self,
        question_number: usize,
        correct_answer: Option<f64>,
    ) -> Result<()> {
        let question_idx = question_number - 1;
        if question_idx >= self.questions.len() {
            return Err(anyhow!("Question does not exist"));
        }
        if self.questions[question_idx].question_config.kind() != QuestionKind::Numeric {
            return Err(anyhow!("Question is not a numeric question"));
        }

        self.questions[question_idx].numeric_correct_answer = correct_answer;
        self.recalculate_numeric_scores(question_idx);

        let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
        let all_team_names: Vec<String> = self.questions[question_idx]
            .answers
            .iter()
            .map(|a| a.team_name.clone())
            .collect();
        for team in all_team_names {
            self.recalculate_team_score(&team);
        }
        for team in speed_bonus_teams {
            self.recalculate_team_score(&team);
        }

        Ok(())
    }

    /// Recalculate question_points for all answers on a numeric question.
    fn recalculate_numeric_scores(&mut self, question_idx: usize) {
        let question = &self.questions[question_idx];
        let Some(correct) = question.numeric_correct_answer else {
            // No correct answer set - clear all question_points
            for answer in &mut self.questions[question_idx].answers {
                answer.score.question_points = 0;
            }
            return;
        };

        let config = match &question.question_config {
            QuestionConfig::Numeric { config } => config.clone(),
            _ => return,
        };
        let base_points = question.question_points;

        match config.scoring_mode {
            NumericScoringMode::ExactOnly => {
                for answer in &mut self.questions[question_idx].answers {
                    if let Some(AnswerContent::Single { answer_text }) = &answer.content {
                        if let Ok(val) = answer_text.trim().parse::<f64>() {
                            answer.score.question_points =
                                calculate_numeric_score_exact(val, correct, base_points);
                        } else {
                            answer.score.question_points = 0;
                        }
                    }
                }
            }
            NumericScoringMode::Range => {
                for answer in &mut self.questions[question_idx].answers {
                    if let Some(AnswerContent::Single { answer_text }) = &answer.content {
                        if let Ok(val) = answer_text.trim().parse::<f64>() {
                            answer.score.question_points = calculate_numeric_score_range(
                                val,
                                correct,
                                base_points,
                                config.range_type,
                                config.range_value,
                                config.range_scoring_type,
                            );
                        } else {
                            answer.score.question_points = 0;
                        }
                    }
                }
            }
            NumericScoringMode::ClosestGuess => {
                let scores = calculate_numeric_score_closest_guess(
                    &self.questions[question_idx].answers,
                    correct,
                    base_points,
                    config.num_winners,
                );
                for answer in &mut self.questions[question_idx].answers {
                    answer.score.question_points =
                        scores.get(&answer.team_name).copied().unwrap_or(0);
                }
            }
        }
    }

    // === Map scoring ===

    /// Set the correct location for a map question and recalculate all scores.
    pub fn set_map_correct_location(
        &mut self,
        question_number: usize,
        correct_location: Option<(f64, f64)>,
    ) -> Result<()> {
        let question_idx = question_number - 1;
        if question_idx >= self.questions.len() {
            return Err(anyhow!("Question does not exist"));
        }
        if self.questions[question_idx].question_config.kind() != QuestionKind::Map {
            return Err(anyhow!("Question is not a map question"));
        }

        self.questions[question_idx].map_correct_location = correct_location;
        self.recalculate_map_scores(question_idx);

        let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
        let all_team_names: Vec<String> = self.questions[question_idx]
            .answers
            .iter()
            .map(|a| a.team_name.clone())
            .collect();
        for team in all_team_names {
            self.recalculate_team_score(&team);
        }
        for team in speed_bonus_teams {
            self.recalculate_team_score(&team);
        }

        Ok(())
    }

    /// Recalculate question_points for all answers on a map question.
    fn recalculate_map_scores(&mut self, question_idx: usize) {
        let question = &self.questions[question_idx];
        let Some((correct_lat, correct_lng)) = question.map_correct_location else {
            // No correct location set - clear all question_points
            for answer in &mut self.questions[question_idx].answers {
                answer.score.question_points = 0;
            }
            return;
        };

        let config = match &question.question_config {
            QuestionConfig::Map { config } => config.clone(),
            _ => return,
        };
        let base_points = question.question_points;

        for answer in &mut self.questions[question_idx].answers {
            if let Some(AnswerContent::Coordinates { lat, lng }) = &answer.content {
                let distance = haversine_distance_km(*lat, *lng, correct_lat, correct_lng);
                answer.score.question_points = calculate_map_score(distance, base_points, &config);
            } else {
                answer.score.question_points = 0;
            }
        }
    }

    // === Settings operations ===

    /// Update game-level settings.
    /// Also updates any existing questions that have NOT yet received answers.
    pub fn update_game_settings(&mut self, settings: GameSettings) {
        self.game_settings = settings.clone();

        let default_question_config = self.game_settings.default_question_config();

        // Update all questions that don't have answers yet
        for question in &mut self.questions {
            if !question.has_answers() {
                question.timer_duration = settings.default_timer_duration;
                question.question_points = settings.default_question_points;
                question.bonus_increment = settings.default_bonus_increment;
                question.question_config = default_question_config.clone();
                question.speed_bonus_enabled = settings.speed_bonus_enabled;
                question.multi_answer_correct_set.clear();
                question.numeric_correct_answer = None;
                question.map_correct_location = None;
            }
        }

        // Update timer display if on unanswered question and timer not running
        let current_q = &self.questions[self.current_question_number - 1];
        if !current_q.has_answers() && !self.timer_running {
            self.timer_seconds_remaining = Some(settings.default_timer_duration);
        }
    }

    /// Update settings for a specific question.
    /// Per-field validation: only rejects changes that would cause actual problems.
    pub fn update_question_settings(
        &mut self,
        question_number: usize,
        timer_duration: u32,
        question_points: u32,
        bonus_increment: u32,
        question_type: QuestionKind,
        speed_bonus_enabled: bool,
    ) -> Result<()> {
        let question_idx = question_number - 1;
        if question_idx >= self.questions.len() {
            return Err(anyhow!("Question does not exist"));
        }

        let question = &self.questions[question_idx];

        // Validate question_type change: blocked if any submission exists
        if question.question_config.kind() != question_type && question.has_answers() {
            return Err(anyhow!(
                "Cannot change question type for a question that has answers"
            ));
        }

        // Validate question_points change: blocked if any answer is scored
        if question.question_points != question_points && question.has_scored_answers() {
            return Err(anyhow!(
                "Cannot change question points for a question that has scored answers"
            ));
        }

        // Validate bonus_increment change: blocked if any answer is scored
        if question.bonus_increment != bonus_increment && question.has_scored_answers() {
            return Err(anyhow!(
                "Cannot change bonus increment for a question that has scored answers"
            ));
        }

        // Validate timer_duration change: blocked if timer is currently running on this question
        if question.timer_duration != timer_duration
            && question_number == self.current_question_number
            && self.timer_running
        {
            return Err(anyhow!(
                "Cannot change timer duration while the timer is running"
            ));
        }

        // speed_bonus_enabled: always allowed

        let question = &mut self.questions[question_idx];
        let speed_bonus_toggled = question.speed_bonus_enabled != speed_bonus_enabled;

        question.timer_duration = timer_duration;
        question.question_points = question_points;
        question.bonus_increment = bonus_increment;
        question.speed_bonus_enabled = speed_bonus_enabled;

        // If question config kind doesn't match the requested type,
        // we changed question types and we need to set the config to the
        // new default
        if question.question_config.kind() != question_type {
            question.question_config = match question_type {
                QuestionKind::Standard => QuestionConfig::Standard,
                QuestionKind::MultiAnswer => QuestionConfig::MultiAnswer {
                    config: self.game_settings.default_multi_answer_config.clone(),
                },
                QuestionKind::MultipleChoice => QuestionConfig::MultipleChoice {
                    config: McConfig::default(),
                },
                QuestionKind::Numeric => QuestionConfig::Numeric {
                    config: self.game_settings.default_numeric_config.clone(),
                },
                QuestionKind::Map => QuestionConfig::Map {
                    config: self.game_settings.default_map_config.clone(),
                },
            };
            // Clear correct set, numeric answer, and map location when switching types
            question.multi_answer_correct_set.clear();
            question.numeric_correct_answer = None;
            question.map_correct_location = None;
        }

        // If speed bonus was toggled on a question with answers, recalculate
        if speed_bonus_toggled && self.questions[question_idx].has_answers() {
            let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
            for team in speed_bonus_teams {
                self.recalculate_team_score(&team);
            }
        }

        // Update timer display if this is current question and timer not running
        if question_number == self.current_question_number && !self.timer_running {
            self.timer_seconds_remaining = Some(timer_duration);
        }

        Ok(())
    }

    pub fn update_type_specific_settings(
        &mut self,
        question_number: usize,
        question_config: QuestionConfig,
    ) -> Result<()> {
        let question_idx = question_number - 1;
        let question = &mut self.questions[question_idx];

        if question_config.kind() != question.question_config.kind() {
            return Err(anyhow!("Config type does not match question type"));
        }

        // Numeric and Map questions allow config updates even with answers (triggers recalculation)
        let kind = question_config.kind();
        if question.has_answers() && kind != QuestionKind::Numeric && kind != QuestionKind::Map {
            return Err(anyhow!(
                "Cannot update settings for a question that has answers"
            ));
        }

        question.question_config = question_config;

        // Recalculate scores if config changed with answers present
        if self.questions[question_idx].has_answers() {
            let kind = self.questions[question_idx].question_config.kind();
            if kind == QuestionKind::Numeric {
                self.recalculate_numeric_scores(question_idx);
            } else if kind == QuestionKind::Map {
                self.recalculate_map_scores(question_idx);
            } else {
                return Ok(());
            }
            let speed_bonus_teams = self.recalculate_speed_bonuses(question_idx);
            let all_team_names: Vec<String> = self.questions[question_idx]
                .answers
                .iter()
                .map(|a| a.team_name.clone())
                .collect();
            for team in all_team_names {
                self.recalculate_team_score(&team);
            }
            for team in speed_bonus_teams {
                self.recalculate_team_score(&team);
            }
        }

        Ok(())
    }

    // === Team connection status ===

    /// Set a team's connected status
    pub fn set_team_connected(&mut self, team_name: &str, connected: bool) -> bool {
        if let Some(team) = self.find_team_mut(team_name) {
            team.connected = connected;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_speed_bonus_3_teams_10_points() {
        // 3 teams eligible, 10 first place points
        // 1st: 10 * 3 / 3 = 10
        // 2nd: 10 * 2 / 3 = 6
        // 3rd: 10 * 1 / 3 = 3
        // 4th+: 0
        assert_eq!(Game::calculate_speed_bonus(0, 3, 10), 10);
        assert_eq!(Game::calculate_speed_bonus(1, 3, 10), 6);
        assert_eq!(Game::calculate_speed_bonus(2, 3, 10), 3);
        assert_eq!(Game::calculate_speed_bonus(3, 3, 10), 0);
        assert_eq!(Game::calculate_speed_bonus(4, 3, 10), 0);
    }

    #[test]
    fn test_calculate_speed_bonus_2_teams_10_points() {
        // 2 teams eligible, 10 first place points
        // 1st: 10 * 2 / 2 = 10
        // 2nd: 10 * 1 / 2 = 5
        // 3rd+: 0
        assert_eq!(Game::calculate_speed_bonus(0, 2, 10), 10);
        assert_eq!(Game::calculate_speed_bonus(1, 2, 10), 5);
        assert_eq!(Game::calculate_speed_bonus(2, 2, 10), 0);
    }

    #[test]
    fn test_calculate_speed_bonus_4_teams_20_points() {
        // 4 teams eligible, 20 first place points
        // 1st: 20 * 4 / 4 = 20
        // 2nd: 20 * 3 / 4 = 15
        // 3rd: 20 * 2 / 4 = 10
        // 4th: 20 * 1 / 4 = 5
        assert_eq!(Game::calculate_speed_bonus(0, 4, 20), 20);
        assert_eq!(Game::calculate_speed_bonus(1, 4, 20), 15);
        assert_eq!(Game::calculate_speed_bonus(2, 4, 20), 10);
        assert_eq!(Game::calculate_speed_bonus(3, 4, 20), 5);
        assert_eq!(Game::calculate_speed_bonus(4, 4, 20), 0);
    }

    #[test]
    fn test_calculate_speed_bonus_1_team() {
        // Only 1 team eligible, 10 first place points
        // 1st: 10 * 1 / 1 = 10
        // 2nd+: 0
        assert_eq!(Game::calculate_speed_bonus(0, 1, 10), 10);
        assert_eq!(Game::calculate_speed_bonus(1, 1, 10), 0);
    }

    #[test]
    fn test_calculate_speed_bonus_zero_points() {
        // Even with teams eligible, 0 first place points = 0 for everyone
        assert_eq!(Game::calculate_speed_bonus(0, 3, 0), 0);
        assert_eq!(Game::calculate_speed_bonus(1, 3, 0), 0);
        assert_eq!(Game::calculate_speed_bonus(2, 3, 0), 0);
    }

    // === Multi-Answer Tests ===

    #[test]
    fn test_grade_multi_answer_all_correct() {
        let correct_set = vec!["blue".to_string(), "red".to_string(), "green".to_string()];
        let answers = vec!["Blue".to_string(), "RED".to_string(), "green".to_string()];
        let result = grade_multi_answer(&answers, &correct_set);
        assert_eq!(result, vec![true, true, true]);
    }

    #[test]
    fn test_grade_multi_answer_partial() {
        let correct_set = vec!["blue".to_string(), "red".to_string(), "green".to_string()];
        let answers = vec![
            "blue".to_string(),
            "yellow".to_string(),
            "green".to_string(),
        ];
        let result = grade_multi_answer(&answers, &correct_set);
        assert_eq!(result, vec![true, false, true]);
    }

    #[test]
    fn test_grade_multi_answer_cardinality_duplicates() {
        // Key test: "blue" appears twice in answers but only once in correct set
        let correct_set = vec!["blue".to_string(), "red".to_string(), "green".to_string()];
        let answers = vec!["blue".to_string(), "blue".to_string(), "red".to_string()];
        let result = grade_multi_answer(&answers, &correct_set);
        assert_eq!(result, vec![true, false, true]);
    }

    #[test]
    fn test_grade_multi_answer_empty_answers() {
        let correct_set = vec!["blue".to_string(), "red".to_string()];
        let answers = vec!["blue".to_string(), "".to_string(), "red".to_string()];
        let result = grade_multi_answer(&answers, &correct_set);
        assert_eq!(result, vec![true, false, true]);
    }

    #[test]
    fn test_calculate_multi_answer_question_points_floor() {
        // base=50, N=3, all correct -> 16*3=48 (not 50)
        let correct = vec![true, true, true];
        assert_eq!(calculate_multi_answer_question_points(&correct, 50, 3), 48);
    }

    #[test]
    fn test_calculate_multi_answer_question_points_partial() {
        // base=90, N=3, 2 correct -> 30*2=60
        let correct = vec![true, false, true];
        assert_eq!(calculate_multi_answer_question_points(&correct, 90, 3), 60);
    }

    #[test]
    fn test_calculate_multi_answer_question_points_none_correct() {
        let correct = vec![false, false, false];
        assert_eq!(calculate_multi_answer_question_points(&correct, 90, 3), 0);
    }

    #[test]
    fn test_is_speed_bonus_eligible_multi_answer_all_correct() {
        let tq = Answer {
            team_name: "Team A".to_string(),
            score: ScoreData {
                question_points: 48,
                ..ScoreData::new()
            },
            content: Some(AnswerContent::Multi {
                answers: vec!["a".into(), "b".into(), "c".into()],
                correct: vec![true, true, true],
            }),
        };
        assert!(tq.is_speed_bonus_eligible());
    }

    #[test]
    fn test_is_speed_bonus_eligible_multi_answer_partial() {
        let tq = Answer {
            team_name: "Team A".to_string(),
            score: ScoreData {
                question_points: 32,
                ..ScoreData::new()
            },
            content: Some(AnswerContent::Multi {
                answers: vec!["a".into(), "b".into(), "c".into()],
                correct: vec![true, false, true],
            }),
        };
        assert!(!tq.is_speed_bonus_eligible());
    }

    /// Helper: create a Game with a multi-answer question (3 sub-answers, 50 pts)
    /// and two registered teams.
    fn setup_multi_answer_game() -> Game {
        use tokio::sync::mpsc;

        let (host_tx, _host_rx) = mpsc::unbounded_channel();
        let mut game = Game::new("TEST".to_string(), host_tx, "host1".to_string());

        // Change the first question to multi-answer
        game.update_question_settings(1, 30, 50, 5, QuestionKind::MultiAnswer, false)
            .unwrap();

        // Add two teams
        let (tx_a, _) = mpsc::unbounded_channel();
        let (tx_b, _) = mpsc::unbounded_channel();
        game.add_team(
            "Team A".to_string(),
            tx_a,
            TeamColor {
                hex_code: "#ff0000".into(),
                name: "Red".into(),
            },
            vec![],
        );
        game.add_team(
            "Team B".to_string(),
            tx_b,
            TeamColor {
                hex_code: "#0000ff".into(),
                name: "Blue".into(),
            },
            vec![],
        );

        game
    }

    /// Helper: extract the `correct` vec for a team from question index 0
    fn get_correct(game: &Game, team_name: &str) -> Vec<bool> {
        let q = &game.questions[0];
        let answer = q.answers.iter().find(|a| a.team_name == team_name).unwrap();
        match &answer.content {
            Some(AnswerContent::Multi { correct, .. }) => correct.clone(),
            _ => panic!("Expected Multi content for {team_name}"),
        }
    }

    /// Helper: get question_points for a team from question index 0
    fn get_question_points(game: &Game, team_name: &str) -> i32 {
        let q = &game.questions[0];
        q.answers
            .iter()
            .find(|a| a.team_name == team_name)
            .unwrap()
            .score
            .question_points
    }

    #[test]
    fn test_toggle_cardinality_duplicate_text() {
        // Scenario: two teams submit overlapping "stop" answers.
        // Toggling pills with the same text should add copies to the
        // correct set, respecting cardinality-aware grading.
        let mut game = setup_multi_answer_game();

        // 1. Team A submits ["stop", "stop", "stop"]
        assert!(game.submit_answer(
            "Team A",
            AnswerSubmission::Multi(vec!["stop".into(), "stop".into(), "stop".into()])
        ));
        // 2. Team B submits ["stop", "go", "fish"]
        assert!(game.submit_answer(
            "Team B",
            AnswerSubmission::Multi(vec!["stop".into(), "go".into(), "fish".into()])
        ));

        // 3. Host clicks Team B's "stop" pill (index 0) -> adds "stop" to correct_set
        assert!(game.toggle_multi_answer_correctness(1, "Team B", 0));

        // 4. Both teams should have exactly one "stop" correct
        //    correct_set = ["stop"]
        //    Team A: ["stop","stop","stop"] graded -> [T, F, F]
        //    Team B: ["stop","go","fish"]   graded -> [T, F, F]
        assert_eq!(get_correct(&game, "Team A"), vec![true, false, false]);
        assert_eq!(get_correct(&game, "Team B"), vec![true, false, false]);
        assert_eq!(get_question_points(&game, "Team A"), 16); // floor(50/3)*1
        assert_eq!(get_question_points(&game, "Team B"), 16);

        // 5. Host clicks Team A's second "stop" pill (index 1, currently incorrect)
        //    -> adds another "stop" to correct_set
        assert!(game.toggle_multi_answer_correctness(1, "Team A", 1));

        // 6. correct_set = ["stop", "stop"]
        //    Team A: ["stop","stop","stop"] graded -> [T, T, F]  (2 correct)
        //    Team B: ["stop","go","fish"]   graded -> [T, F, F]  (1 correct, only one "stop" to match)
        //    Team A has twice as many points as Team B.
        assert_eq!(get_correct(&game, "Team A"), vec![true, true, false]);
        assert_eq!(get_correct(&game, "Team B"), vec![true, false, false]);
        assert_eq!(get_question_points(&game, "Team A"), 32); // floor(50/3)*2
        assert_eq!(get_question_points(&game, "Team B"), 16); // floor(50/3)*1
    }

    #[test]
    fn test_is_speed_bonus_eligible_standard() {
        let tq = Answer {
            team_name: "Team A".to_string(),
            score: ScoreData {
                question_points: 50,
                ..ScoreData::new()
            },
            content: Some(AnswerContent::Single {
                answer_text: "Paris".into(),
            }),
        };
        assert!(tq.is_speed_bonus_eligible());

        let tq_zero = Answer {
            team_name: "Team B".to_string(),
            score: ScoreData::new(),
            content: Some(AnswerContent::Single {
                answer_text: "London".into(),
            }),
        };
        assert!(!tq_zero.is_speed_bonus_eligible());
    }

    // === Map scoring tests ===

    #[test]
    fn test_haversine_distance_same_point() {
        let d = haversine_distance_km(48.8584, 2.2945, 48.8584, 2.2945);
        assert_eq!(d, 0.0);
    }

    #[test]
    fn test_haversine_distance_known_cities() {
        // Paris to London: ~344 km
        let d = haversine_distance_km(48.8566, 2.3522, 51.5074, -0.1278);
        assert!((d - 344.0).abs() < 5.0, "Paris-London distance was {d}");
    }

    #[test]
    fn test_haversine_distance_antipodal() {
        // North pole to south pole: ~20,015 km
        let d = haversine_distance_km(90.0, 0.0, -90.0, 0.0);
        assert!((d - 20015.0).abs() < 100.0, "Pole-to-pole distance was {d}");
    }

    #[test]
    fn test_map_score_exact_match() {
        let config = MapConfig::default();
        let score = calculate_map_score(0.0, 1000, &config);
        assert_eq!(score, 1000);
    }

    #[test]
    fn test_map_score_within_full_points_threshold() {
        let config = MapConfig::default(); // full_points_distance_km = 0.025
        let score = calculate_map_score(0.020, 1000, &config);
        assert_eq!(score, 1000);
    }

    #[test]
    fn test_map_score_just_outside_threshold() {
        let config = MapConfig::default();
        let score = calculate_map_score(0.030, 1000, &config);
        assert!(score < 1000);
        assert!(score > 990, "Score was {score}, expected close to 1000");
    }

    #[test]
    fn test_map_score_moderate_distance() {
        let config = MapConfig::default(); // zero_points_distance_km = 20000
        // 100 km away: score = 1000 * e^(-10 * 100 / 20000) = 1000 * e^(-0.05) ≈ 951
        let score = calculate_map_score(100.0, 1000, &config);
        assert!((score - 951).abs() <= 2, "Score was {score}");
    }

    #[test]
    fn test_map_score_very_far() {
        let config = MapConfig::default();
        // 10000 km away: score = 1000 * e^(-10 * 10000 / 20000) = 1000 * e^(-5) ≈ 6
        let score = calculate_map_score(10000.0, 1000, &config);
        assert!(score < 10, "Score was {score}");
        assert!(score >= 0);
    }

    #[test]
    fn test_map_score_at_zero_distance() {
        let config = MapConfig::default();
        // At the zero_points_distance: score = 1000 * e^(-10) ≈ 0
        let score = calculate_map_score(20000.0, 1000, &config);
        assert_eq!(score, 0);
    }

    #[test]
    fn test_map_score_custom_config() {
        let config = MapConfig {
            full_points_distance_km: 1.0,   // 1 km for full points
            zero_points_distance_km: 100.0, // 100 km for zero
        };
        // Within threshold
        assert_eq!(calculate_map_score(0.5, 500, &config), 500);
        // At threshold edge
        assert_eq!(calculate_map_score(1.0, 500, &config), 500);
        // Beyond threshold: 50 km away = 500 * e^(-10 * 50 / 100) = 500 * e^(-5) ≈ 3
        let score = calculate_map_score(50.0, 500, &config);
        assert!(score < 10, "Score was {score}");
    }

    #[test]
    fn test_is_speed_bonus_eligible_map() {
        // Map answer with points > 0 should be eligible
        let answer = Answer {
            team_name: "Team A".to_string(),
            score: ScoreData {
                question_points: 500,
                ..ScoreData::new()
            },
            content: Some(AnswerContent::Coordinates {
                lat: 48.8584,
                lng: 2.2945,
            }),
        };
        assert!(answer.is_speed_bonus_eligible());

        // Map answer with 0 points should not be eligible
        let answer_zero = Answer {
            team_name: "Team B".to_string(),
            score: ScoreData::new(),
            content: Some(AnswerContent::Coordinates { lat: 0.0, lng: 0.0 }),
        };
        assert!(!answer_zero.is_speed_bonus_eligible());
    }
}
