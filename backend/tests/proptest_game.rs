//! Property-based tests over the `Game` state machine.
//!
//! Drives `Game` directly (no WebSocket) so shrinking stays fast and
//! deterministic. Complex structs like `GameSettings` and `NumericConfig`
//! are decomposed into per-field strategies; adding a new field becomes
//! a compile error here (rather than silent generator drift).
//!
//! The submission generator is a hybrid: random `SubmitSingle/Multi/Coord/Numeric`
//! variants exercise the rejection / atomicity paths, while `SubmitForCurrent`
//! inspects the current question's type at apply-time and submits a matching
//! shape so that happy-path coverage doesn't dilute as more question types
//! are added.

use backend::model::game::Game;
use backend::model::server_message::GameState;
use backend::model::types::{
    AnswerContent, AnswerSubmission, GameSettings, MapConfig, McConfig, McOptionType,
    MultiAnswerConfig, NumericConfig, NumericRangeType, NumericScoringMode, QuestionKind,
    RangeScoringType, ScoreData, TeamColor,
};
use proptest::prelude::*;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use tokio::sync::mpsc;

const TEAMS: [&str; 3] = ["Alpha", "Bravo", "Charlie"];

// === Coverage stats =========================================================
//
// Global event histogram accumulated across all proptest cases. `record(...)`
// fires from inside `apply` and the invariant blocks. A thread-local guard
// prints the histogram to stderr when the test thread exits, so running
// `cargo test --test proptest_game -- --test-threads=1 --nocapture` gives
// one clean cumulative table at the end. Without `--test-threads=1` the
// output may be partial / printed twice (one per test thread).

fn stats() -> &'static Mutex<BTreeMap<&'static str, usize>> {
    static S: OnceLock<Mutex<BTreeMap<&'static str, usize>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn record(event: &'static str) {
    if let Ok(mut s) = stats().lock() {
        *s.entry(event).or_insert(0) += 1;
    }
}

/// Total number of `StatsGuard`s that have been dropped — used to label
/// each histogram printout so the reader can tell which is the cumulative
/// final one.
static DROPS: AtomicUsize = AtomicUsize::new(0);

struct StatsGuard;
impl Drop for StatsGuard {
    fn drop(&mut self) {
        let n = DROPS.fetch_add(1, Ordering::SeqCst) + 1;
        let s = match stats().lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        if s.is_empty() {
            return;
        }
        eprintln!("\n--- proptest_game event histogram (thread {n}) ---");
        for (event, count) in s.iter() {
            eprintln!("  {event:<48} {count}");
        }
    }
}

thread_local! {
    static STATS_GUARD: StatsGuard = const { StatsGuard };
}

fn touch_stats_guard() {
    STATS_GUARD.with(|_| {});
}

fn make_game() -> Game {
    let (host_tx, _host_rx) = mpsc::unbounded_channel();
    let mut game = Game::new("TEST".into(), host_tx, "host1".into());
    for name in TEAMS {
        let (tx, _rx) = mpsc::unbounded_channel();
        game.add_team(
            name.to_string(),
            tx,
            TeamColor {
                hex_code: "#000000".into(),
                name: "Black".into(),
            },
            vec![],
        );
    }
    game
}

#[derive(Debug, Clone)]
enum Action {
    // --- Submissions ---
    Submit {
        team_idx: usize,
        answer: String,
    },
    SubmitMulti {
        team_idx: usize,
        answers: Vec<String>,
    },
    SubmitCoord {
        team_idx: usize,
        lat: f64,
        lng: f64,
    },
    SubmitNumeric {
        team_idx: usize,
        value: f64,
    },
    /// Hybrid action: payload carries one of each submission shape, apply()
    /// picks the variant that matches the current question's type so the
    /// submission is guaranteed to be syntactically valid.
    SubmitForCurrent {
        team_idx: usize,
        single: String,
        multi: Vec<String>,
        lat: f64,
        lng: f64,
        numeric: f64,
    },

    // --- Scoring ---
    Score {
        team_idx: usize,
        question_number: usize,
        question_points: i32,
        bonus_points: i32,
    },
    ClearAnswerScore {
        team_idx: usize,
        question_number: usize,
    },
    OverrideTeamScore {
        team_idx: usize,
        override_points: i32,
    },
    SetNumericCorrectAnswer {
        question_number: usize,
        value: Option<f64>,
    },
    SetMapCorrectLocation {
        question_number: usize,
        location: Option<(f64, f64)>,
    },
    ToggleMultiAnswerCorrectness {
        team_idx: usize,
        question_number: usize,
        sub_answer_index: usize,
    },

    // --- Navigation / settings ---
    NextQuestion,
    PrevQuestion,
    UpdateGameSettings {
        settings: GameSettings,
    },
    UpdateQuestionSettings {
        question_number: usize,
        timer_duration: u32,
        question_points: u32,
        bonus_increment: u32,
        question_type: QuestionKind,
        speed_bonus_enabled: bool,
    },

    // --- Connection ---
    SetTeamConnected {
        team_idx: usize,
        connected: bool,
    },
    RejoinTeam {
        team_idx: usize,
    },
    AddTeam {
        team_idx: usize,
    },
}

// Static exhaustiveness checks. Adding a variant here breaks compilation,
// which is a reminder to update `action_strategy` and `apply` together.
#[allow(dead_code)]
fn _exhaustive_action(a: &Action) {
    match a {
        Action::Submit { .. }
        | Action::SubmitMulti { .. }
        | Action::SubmitCoord { .. }
        | Action::SubmitNumeric { .. }
        | Action::SubmitForCurrent { .. }
        | Action::Score { .. }
        | Action::ClearAnswerScore { .. }
        | Action::OverrideTeamScore { .. }
        | Action::SetNumericCorrectAnswer { .. }
        | Action::SetMapCorrectLocation { .. }
        | Action::ToggleMultiAnswerCorrectness { .. }
        | Action::NextQuestion
        | Action::PrevQuestion
        | Action::UpdateGameSettings { .. }
        | Action::UpdateQuestionSettings { .. }
        | Action::SetTeamConnected { .. }
        | Action::RejoinTeam { .. }
        | Action::AddTeam { .. } => (),
    }
}
#[allow(dead_code)]
fn _exhaustive_question_kind(k: QuestionKind) {
    match k {
        QuestionKind::Standard
        | QuestionKind::MultiAnswer
        | QuestionKind::MultipleChoice
        | QuestionKind::Numeric
        | QuestionKind::Map => (),
    }
}

// === Strategies for value types ===
//
// Each complex struct is decomposed into a tuple-of-fields and reassembled
// via an explicit struct constructor. Adding a field to the struct fails to
// compile here (rather than silently shrinking generator coverage).

fn question_kind_strategy() -> impl Strategy<Value = QuestionKind> {
    prop_oneof![
        Just(QuestionKind::Standard),
        Just(QuestionKind::MultiAnswer),
        Just(QuestionKind::MultipleChoice),
        Just(QuestionKind::Numeric),
        Just(QuestionKind::Map),
    ]
}

fn mc_config_strategy() -> impl Strategy<Value = McConfig> {
    (
        prop_oneof![
            Just(McOptionType::Letters),
            Just(McOptionType::Numbers),
            Just(McOptionType::YesNo),
            Just(McOptionType::TrueFalse),
            Just(McOptionType::Other),
        ],
        2u32..=8,
        prop::option::of(prop::collection::vec("[a-z]{1,4}", 2..=6)),
    )
        .prop_map(|(option_type, num_options, custom_options)| McConfig {
            option_type,
            num_options,
            custom_options,
        })
}

fn multi_answer_config_strategy() -> impl Strategy<Value = MultiAnswerConfig> {
    (1u32..=5).prop_map(|num_answers| MultiAnswerConfig { num_answers })
}

fn numeric_config_strategy() -> impl Strategy<Value = NumericConfig> {
    (
        prop_oneof![
            Just(NumericScoringMode::ExactOnly),
            Just(NumericScoringMode::Range),
            Just(NumericScoringMode::ClosestGuess),
        ],
        prop_oneof![
            Just(NumericRangeType::Absolute),
            Just(NumericRangeType::Percent),
        ],
        prop_oneof![Just(RangeScoringType::Linear), Just(RangeScoringType::Flat)],
        0.0f64..=100.0,
        1u32..=5,
    )
        .prop_map(
            |(scoring_mode, range_type, range_scoring_type, range_value, num_winners)| {
                NumericConfig {
                    scoring_mode,
                    range_type,
                    range_value,
                    num_winners,
                    range_scoring_type,
                }
            },
        )
}

fn map_config_strategy() -> impl Strategy<Value = MapConfig> {
    (0.001f64..=10.0, 10.0f64..=20000.0).prop_map(
        |(full_points_distance_km, one_point_distance_km)| MapConfig {
            full_points_distance_km,
            one_point_distance_km,
        },
    )
}

fn game_settings_strategy() -> impl Strategy<Value = GameSettings> {
    (
        (1u32..=120, 0u32..=100, 0u32..=20),
        question_kind_strategy(),
        mc_config_strategy(),
        multi_answer_config_strategy(),
        numeric_config_strategy(),
        map_config_strategy(),
        (any::<bool>(), 1u32..=8, 0u32..=30),
    )
        .prop_map(
            |(
                (default_timer_duration, default_question_points, default_bonus_increment),
                default_question_type,
                default_mc_config,
                default_multi_answer_config,
                default_numeric_config,
                default_map_config,
                (speed_bonus_enabled, speed_bonus_num_teams, speed_bonus_first_place_points),
            )| GameSettings {
                default_timer_duration,
                default_question_points,
                default_bonus_increment,
                default_question_type,
                default_mc_config,
                default_multi_answer_config,
                default_numeric_config,
                default_map_config,
                speed_bonus_enabled,
                speed_bonus_num_teams,
                speed_bonus_first_place_points,
            },
        )
}

// === Action strategy ===
//
// Grouped to stay within prop_oneof's 10-arm comfort range. Inner weights
// sum to a group total; the outer prop_oneof then weighs the groups
// against each other.

fn submission_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        4 => (0..TEAMS.len(), "[a-z]{1,6}")
            .prop_map(|(team_idx, answer)| Action::Submit { team_idx, answer }),
        3 => (0..TEAMS.len(), prop::collection::vec("[a-z]{0,5}", 1..=5))
            .prop_map(|(team_idx, answers)| Action::SubmitMulti { team_idx, answers }),
        3 => (0..TEAMS.len(), -100.0f64..=100.0, -200.0f64..=200.0)
            .prop_map(|(team_idx, lat, lng)| Action::SubmitCoord { team_idx, lat, lng }),
        3 => (0..TEAMS.len(), -1000.0f64..=1000.0)
            .prop_map(|(team_idx, value)| Action::SubmitNumeric { team_idx, value }),
        4 => (
            0..TEAMS.len(),
            "[a-z]{1,6}",
            prop::collection::vec("[a-z]{0,5}", 1..=5),
            -90.0f64..=90.0,
            -180.0f64..=180.0,
            -1000.0f64..=1000.0,
        ).prop_map(|(team_idx, single, multi, lat, lng, numeric)|
            Action::SubmitForCurrent { team_idx, single, multi, lat, lng, numeric }),
    ]
}

fn scoring_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        3 => (0..TEAMS.len(), 1usize..=15, 0i32..=50, -10i32..=10)
            .prop_map(|(team_idx, question_number, question_points, bonus_points)| {
                Action::Score { team_idx, question_number, question_points, bonus_points }
            }),
        1 => (0..TEAMS.len(), 1usize..=15)
            .prop_map(|(team_idx, question_number)| {
                Action::ClearAnswerScore { team_idx, question_number }
            }),
        1 => (0..TEAMS.len(), -100i32..=100)
            .prop_map(|(team_idx, override_points)| {
                Action::OverrideTeamScore { team_idx, override_points }
            }),
        2 => (1usize..=15, prop::option::of(-1000.0f64..=1000.0))
            .prop_map(|(question_number, value)| {
                Action::SetNumericCorrectAnswer { question_number, value }
            }),
        2 => (
            1usize..=15,
            prop::option::of((-90.0f64..=90.0, -180.0f64..=180.0))
        ).prop_map(|(question_number, location)| {
            Action::SetMapCorrectLocation { question_number, location }
        }),
        2 => (0..TEAMS.len(), 1usize..=15, 0usize..=5)
            .prop_map(|(team_idx, question_number, sub_answer_index)| {
                Action::ToggleMultiAnswerCorrectness { team_idx, question_number, sub_answer_index }
            }),
    ]
}

fn nav_settings_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        4 => Just(Action::NextQuestion),
        1 => Just(Action::PrevQuestion),
        1 => game_settings_strategy()
            .prop_map(|settings| Action::UpdateGameSettings { settings }),
        2 => (
            1usize..=15,
            1u32..=120,
            0u32..=100,
            0u32..=20,
            question_kind_strategy(),
            any::<bool>(),
        ).prop_map(|(
            question_number,
            timer_duration,
            question_points,
            bonus_increment,
            question_type,
            speed_bonus_enabled,
        )| Action::UpdateQuestionSettings {
            question_number,
            timer_duration,
            question_points,
            bonus_increment,
            question_type,
            speed_bonus_enabled,
        }),
    ]
}

fn connection_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        1 => (0..TEAMS.len(), any::<bool>())
            .prop_map(|(team_idx, connected)| Action::SetTeamConnected { team_idx, connected }),
        1 => (0..TEAMS.len()).prop_map(|team_idx| Action::RejoinTeam { team_idx }),
        1 => (0..TEAMS.len()).prop_map(|team_idx| Action::AddTeam { team_idx }),
    ]
}

fn action_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        17 => submission_strategy(),
        11 => scoring_strategy(),
        8 => nav_settings_strategy(),
        3 => connection_strategy(),
    ]
}

// === Action application ===

/// True for actions that can legitimately mutate any team's answer scores.
/// The complement set must not change `answer.score` on any pre-existing
/// answer (Wave 2 generalization of retroactive immutability).
fn is_scoring_action(action: &Action) -> bool {
    match action {
        Action::Submit { .. }
        | Action::SubmitMulti { .. }
        | Action::SubmitCoord { .. }
        | Action::SubmitNumeric { .. }
        | Action::SubmitForCurrent { .. }
        | Action::Score { .. }
        | Action::ClearAnswerScore { .. }
        | Action::OverrideTeamScore { .. }
        | Action::SetNumericCorrectAnswer { .. }
        | Action::SetMapCorrectLocation { .. }
        | Action::ToggleMultiAnswerCorrectness { .. }
        // update_question_settings can re-run speed bonuses on a question with
        // answers when speed_bonus_enabled flips, so it can mutate answer scores.
        | Action::UpdateQuestionSettings { .. } => true,
        Action::NextQuestion
        | Action::PrevQuestion
        | Action::UpdateGameSettings { .. }
        | Action::SetTeamConnected { .. }
        | Action::RejoinTeam { .. }
        | Action::AddTeam { .. } => false,
    }
}

/// Inspect the team's answer on the current question, if it just landed, and
/// record any "auto-scored positive" / "speed bonus awarded" signals so we
/// can see whether the scoring engines are actually firing.
fn record_post_submit_signals(game: &Game, team_name: &str) {
    let q = game.current_question();
    let kind = q.question_config.kind();
    let Some(a) = q
        .answers
        .iter()
        .find(|a| a.team_name.eq_ignore_ascii_case(team_name))
    else {
        return;
    };
    if a.score.question_points > 0 {
        match kind {
            QuestionKind::Numeric => record("numeric_auto_scored_positive"),
            QuestionKind::Map => record("map_auto_scored_positive"),
            QuestionKind::MultiAnswer => record("multi_auto_scored_positive"),
            _ => record("single_auto_scored_positive"),
        }
    }
    if a.score.speed_bonus_points > 0 {
        record("speed_bonus_awarded");
    }
}

fn apply(game: &mut Game, action: &Action) {
    match action {
        Action::Submit { team_idx, answer } => {
            let ok = game.submit_answer(TEAMS[*team_idx], AnswerSubmission::Single(answer.clone()));
            record(if ok {
                "submit_single_accepted"
            } else {
                "submit_single_rejected"
            });
            if ok {
                record_post_submit_signals(game, TEAMS[*team_idx]);
            }
        }
        Action::SubmitMulti { team_idx, answers } => {
            let ok = game.submit_answer(TEAMS[*team_idx], AnswerSubmission::Multi(answers.clone()));
            record(if ok {
                "submit_multi_accepted"
            } else {
                "submit_multi_rejected"
            });
            if ok {
                record_post_submit_signals(game, TEAMS[*team_idx]);
            }
        }
        Action::SubmitCoord { team_idx, lat, lng } => {
            let ok = game.submit_answer(
                TEAMS[*team_idx],
                AnswerSubmission::Coordinates {
                    lat: *lat,
                    lng: *lng,
                },
            );
            record(if ok {
                "submit_coord_accepted"
            } else {
                "submit_coord_rejected"
            });
            if ok {
                record_post_submit_signals(game, TEAMS[*team_idx]);
            }
        }
        Action::SubmitNumeric { team_idx, value } => {
            let ok = game.submit_answer(
                TEAMS[*team_idx],
                AnswerSubmission::Single(value.to_string()),
            );
            record(if ok {
                "submit_numeric_accepted"
            } else {
                "submit_numeric_rejected"
            });
            if ok {
                record_post_submit_signals(game, TEAMS[*team_idx]);
            }
        }
        Action::SubmitForCurrent {
            team_idx,
            single,
            multi,
            lat,
            lng,
            numeric,
        } => {
            let kind = game.current_question().question_config.kind();
            record(match kind {
                QuestionKind::Standard => "submit_for_current::standard",
                QuestionKind::MultiAnswer => "submit_for_current::multi_answer",
                QuestionKind::MultipleChoice => "submit_for_current::multiple_choice",
                QuestionKind::Numeric => "submit_for_current::numeric",
                QuestionKind::Map => "submit_for_current::map",
            });
            let submission = match kind {
                QuestionKind::Standard | QuestionKind::MultipleChoice => {
                    AnswerSubmission::Single(single.clone())
                }
                QuestionKind::MultiAnswer => AnswerSubmission::Multi(multi.clone()),
                QuestionKind::Numeric => AnswerSubmission::Single(numeric.to_string()),
                QuestionKind::Map => AnswerSubmission::Coordinates {
                    lat: *lat,
                    lng: *lng,
                },
            };
            let ok = game.submit_answer(TEAMS[*team_idx], submission);
            record(if ok {
                "submit_for_current_accepted"
            } else {
                "submit_for_current_rejected"
            });
            if ok {
                record_post_submit_signals(game, TEAMS[*team_idx]);
            }
        }
        Action::Score {
            team_idx,
            question_number,
            question_points,
            bonus_points,
        } => {
            let score = ScoreData {
                question_points: *question_points,
                bonus_points: *bonus_points,
                ..ScoreData::new()
            };
            let ok = game.score_answer(*question_number, TEAMS[*team_idx], score);
            record(if ok {
                "score_answer_ok"
            } else {
                "score_answer_no_op"
            });
        }
        Action::ClearAnswerScore {
            team_idx,
            question_number,
        } => {
            let ok = game.clear_answer_score(*question_number, TEAMS[*team_idx]);
            record(if ok {
                "clear_answer_score_ok"
            } else {
                "clear_answer_score_no_op"
            });
        }
        Action::OverrideTeamScore {
            team_idx,
            override_points,
        } => {
            game.override_team_score(TEAMS[*team_idx], *override_points);
            record("override_team_score");
        }
        Action::SetNumericCorrectAnswer {
            question_number,
            value,
        } => {
            // Invariant: illegal-call atomicity for the Numeric correct-answer setter.
            let before = serde_json::to_string(&game.to_game_state()).unwrap();
            let result = game.set_numeric_correct_answer(*question_number, *value);
            if result.is_err() {
                record("set_numeric_correct_answer_err");
                let after = serde_json::to_string(&game.to_game_state()).unwrap();
                assert_eq!(
                    before, after,
                    "rejected set_numeric_correct_answer mutated state"
                );
                record("atomicity_check::set_numeric_correct_answer");
            } else {
                record("set_numeric_correct_answer_ok");
            }
        }
        Action::SetMapCorrectLocation {
            question_number,
            location,
        } => {
            // Invariant: illegal-call atomicity for the Map correct-location setter.
            let before = serde_json::to_string(&game.to_game_state()).unwrap();
            let result = game.set_map_correct_location(*question_number, *location);
            if result.is_err() {
                record("set_map_correct_location_err");
                let after = serde_json::to_string(&game.to_game_state()).unwrap();
                assert_eq!(
                    before, after,
                    "rejected set_map_correct_location mutated state"
                );
                record("atomicity_check::set_map_correct_location");
            } else {
                record("set_map_correct_location_ok");
            }
        }
        Action::ToggleMultiAnswerCorrectness {
            team_idx,
            question_number,
            sub_answer_index,
        } => {
            let ok = game.toggle_multi_answer_correctness(
                *question_number,
                TEAMS[*team_idx],
                *sub_answer_index,
            );
            record(if ok {
                "toggle_multi_answer_correctness_ok"
            } else {
                "toggle_multi_answer_correctness_no_op"
            });
        }
        Action::NextQuestion => {
            let len_before = game.questions.len();
            game.next_question();
            if game.questions.len() > len_before {
                let kind = game.current_question().question_config.kind();
                record(match kind {
                    QuestionKind::Standard => "question_created::standard",
                    QuestionKind::MultiAnswer => "question_created::multi_answer",
                    QuestionKind::MultipleChoice => "question_created::multiple_choice",
                    QuestionKind::Numeric => "question_created::numeric",
                    QuestionKind::Map => "question_created::map",
                });
            } else {
                record("next_question_existing");
            }
        }
        Action::PrevQuestion => {
            let ok = game.prev_question().is_ok();
            record(if ok {
                "prev_question_ok"
            } else {
                "prev_question_at_first"
            });
        }
        Action::UpdateGameSettings { settings } => {
            // Wave 1 invariant (stronger than the wave 2 generalization for this
            // specific action): update_game_settings must leave already-answered
            // questions byte-identical, not just their score fields.
            let snapshots: Vec<(usize, String)> = game
                .questions
                .iter()
                .enumerate()
                .filter(|(_, q)| q.has_answers())
                .map(|(i, q)| (i, serde_json::to_string(q).unwrap()))
                .collect();
            let snapshot_count = snapshots.len();
            game.update_game_settings(settings.clone());
            for (i, before) in snapshots {
                let after = serde_json::to_string(&game.questions[i]).unwrap();
                assert_eq!(
                    before,
                    after,
                    "update_game_settings mutated answered question {}",
                    i + 1
                );
            }
            record("update_game_settings");
            if snapshot_count > 0 {
                record("update_game_settings_with_answered_questions");
            }
        }
        Action::UpdateQuestionSettings {
            question_number,
            timer_duration,
            question_points,
            bonus_increment,
            question_type,
            speed_bonus_enabled,
        } => {
            // Invariant: illegal-call atomicity.
            let before = serde_json::to_string(&game.to_game_state()).unwrap();
            let result = game.update_question_settings(
                *question_number,
                *timer_duration,
                *question_points,
                *bonus_increment,
                *question_type,
                *speed_bonus_enabled,
            );
            if result.is_err() {
                record("update_question_settings_err");
                let after = serde_json::to_string(&game.to_game_state()).unwrap();
                assert_eq!(
                    before, after,
                    "rejected update_question_settings mutated state"
                );
                record("atomicity_check::update_question_settings");
            } else {
                record("update_question_settings_ok");
            }
        }
        Action::SetTeamConnected {
            team_idx,
            connected,
        } => {
            game.set_team_connected(TEAMS[*team_idx], *connected);
            record("set_team_connected");
        }
        Action::RejoinTeam { team_idx } => {
            let (tx, _rx) = mpsc::unbounded_channel();
            game.rejoin_team(TEAMS[*team_idx], tx);
            record("rejoin_team");
        }
        Action::AddTeam { team_idx } => {
            let (tx, _rx) = mpsc::unbounded_channel();
            game.add_team(
                TEAMS[*team_idx].to_string(),
                tx,
                TeamColor {
                    hex_code: "#000000".into(),
                    name: "Black".into(),
                },
                vec![],
            );
            record("add_team");
        }
    }
}

// === Invariants ===

/// (Q index, team name, score JSON) per existing answer. Used for the wave 2
/// generalized retroactive-immutability check.
type ScoreSnapshot = Vec<(usize, String, String)>;

fn snapshot_answer_scores(game: &Game) -> ScoreSnapshot {
    let mut out = Vec::new();
    for (qi, q) in game.questions.iter().enumerate() {
        for a in &q.answers {
            out.push((
                qi,
                a.team_name.clone(),
                serde_json::to_string(&a.score).unwrap(),
            ));
        }
    }
    out
}

fn assert_answer_scores_unchanged(game: &Game, before: &ScoreSnapshot, action_label: &str) {
    let after = snapshot_answer_scores(game);
    assert_eq!(
        before, &after,
        "{action_label} mutated already-existing answer scores"
    );
}

/// For every team, the cumulative team score equals the sum of that team's
/// per-question score components across every question.
fn assert_cumulative_score_consistent(game: &Game) {
    for team in &game.teams {
        let (mut q_sum, mut b_sum, mut s_sum) = (0i32, 0i32, 0i32);
        for question in &game.questions {
            if let Some(a) = question
                .answers
                .iter()
                .find(|a| a.team_name.eq_ignore_ascii_case(&team.team_name))
            {
                q_sum += a.score.question_points;
                b_sum += a.score.bonus_points;
                s_sum += a.score.speed_bonus_points;
            }
        }
        assert_eq!(
            team.score.question_points, q_sum,
            "question_points mismatch for {}",
            team.team_name
        );
        assert_eq!(
            team.score.bonus_points, b_sum,
            "bonus_points mismatch for {}",
            team.team_name
        );
        assert_eq!(
            team.score.speed_bonus_points, s_sum,
            "speed_bonus_points mismatch for {}",
            team.team_name
        );
    }
}

/// Multi-answer shape: `correct.len()` must always match `answers.len()`.
fn assert_multi_answer_shape(game: &Game) {
    for (qi, q) in game.questions.iter().enumerate() {
        for a in &q.answers {
            if let Some(AnswerContent::Multi { answers, correct }) = &a.content {
                assert_eq!(
                    answers.len(),
                    correct.len(),
                    "Multi shape mismatch on question {} team {}: answers={} correct={}",
                    qi + 1,
                    a.team_name,
                    answers.len(),
                    correct.len()
                );
            }
        }
    }
}

/// The host view and per-team view must agree on team-level and per-question
/// scores. A bug in `filter_for_team` would surface here.
fn assert_filtered_view_consistency(game: &Game) {
    for team in &game.teams {
        let team_state = game
            .to_team_game_state(&team.team_name)
            .expect("team should exist in to_team_game_state");

        assert_eq!(
            serde_json::to_string(&team_state.team.score).unwrap(),
            serde_json::to_string(&team.score).unwrap(),
            "to_team_game_state team.score diverges from game.teams for {}",
            team.team_name
        );

        assert_eq!(
            team_state.questions.len(),
            game.questions.len(),
            "to_team_game_state question count diverges for {}",
            team.team_name
        );

        for (qi, q) in game.questions.iter().enumerate() {
            let expected = q
                .answers
                .iter()
                .find(|a| a.team_name.eq_ignore_ascii_case(&team.team_name))
                .map(|a| a.score.clone())
                .unwrap_or_default();
            let actual = &team_state.questions[qi].score;
            assert_eq!(
                serde_json::to_string(&expected).unwrap(),
                serde_json::to_string(actual).unwrap(),
                "team {} question {} score diverges between host and team view",
                team.team_name,
                qi + 1
            );
        }
    }
}

/// Round-tripping through `to_game_state -> from_saved_state -> to_game_state`
/// should reach a fixpoint after one cycle: the first restore normalizes
/// (timer stopped, teams disconnected); subsequent saves and restores must
/// produce byte-identical state.
fn assert_save_restore_fixpoint(game: &Game) {
    let state_once = save_restore_save(game);
    let state_twice = save_restore_save_str(&state_once);
    assert_eq!(
        state_once, state_twice,
        "save/restore is not a fixpoint after normalization"
    );
}

fn save_restore_save(game: &Game) -> String {
    let state = game.to_game_state();
    let (tx, _rx) = mpsc::unbounded_channel();
    let restored = Game::from_saved_state("host1".into(), game.game_code.clone(), tx, state);
    serde_json::to_string(&restored.to_game_state()).unwrap()
}

fn save_restore_save_str(state_json: &str) -> String {
    let state: GameState = serde_json::from_str(state_json).unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let restored = Game::from_saved_state("host1".into(), state.game_code.clone(), tx, state);
    serde_json::to_string(&restored.to_game_state()).unwrap()
}

fn assert_all_invariants(game: &Game) {
    assert_cumulative_score_consistent(game);
    record("invariant::cumulative_score_consistent");
    assert_multi_answer_shape(game);
    record("invariant::multi_answer_shape");
    assert_filtered_view_consistency(game);
    record("invariant::filtered_view_consistency");
    assert_save_restore_fixpoint(game);
    record("invariant::save_restore_fixpoint");
}

fn questions_json(game: &Game) -> Vec<String> {
    game.questions
        .iter()
        .map(|q| serde_json::to_string(q).unwrap())
        .collect()
}

proptest! {
    /// Drives the full Wave 1 + Wave 2 invariant suite. After every action:
    /// - cumulative scores stay consistent
    /// - Multi answer shape (correct.len == answers.len) holds
    /// - filtered (per-team) view agrees with the host view
    /// - save/restore is a fixpoint after normalization
    ///
    /// For non-scoring actions, also asserts that already-existing answer
    /// scores didn't change (generalized retroactive immutability). For
    /// rejected updates (Result::Err / etc.), the per-action handler in
    /// `apply` enforces illegal-call atomicity.
    #[test]
    fn invariants_hold_across_action_trace(
        actions in prop::collection::vec(action_strategy(), 0..50),
    ) {
        touch_stats_guard();
        record("case::invariants_hold_across_action_trace");
        let mut game = make_game();
        for action in &actions {
            let pre = if !is_scoring_action(action) {
                Some(snapshot_answer_scores(&game))
            } else {
                None
            };

            apply(&mut game, action);

            if let Some(pre) = pre {
                assert_answer_scores_unchanged(&game, &pre, &format!("{:?}", action));
                record("invariant::retroactive_score_immutability");
            }

            assert_all_invariants(&game);
        }
    }

    /// Navigating forward and then back leaves every existing question's
    /// answer/score state byte-equal to before the navigation. Timer state
    /// is allowed to differ (navigation resets the displayed timer).
    #[test]
    fn navigation_round_trip_preserves_question_state(
        actions in prop::collection::vec(action_strategy(), 0..30),
    ) {
        touch_stats_guard();
        record("case::navigation_round_trip_preserves_question_state");
        let mut game = make_game();
        for action in &actions {
            apply(&mut game, action);
        }

        let q_before = game.current_question_number;
        let snapshot = questions_json(&game);

        game.next_question();
        game.prev_question().expect("prev after next should always succeed");

        prop_assert_eq!(game.current_question_number, q_before);

        let after = questions_json(&game);
        for (i, before) in snapshot.iter().enumerate() {
            prop_assert_eq!(before, &after[i], "question {} mutated by navigation", i + 1);
        }
    }
}
