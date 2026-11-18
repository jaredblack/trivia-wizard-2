//! A deck attached to a game: presets shape questions as they are created, and
//! answer keys score matching submissions on arrival.

use crate::{TestClient, TestServer};

use backend::model::client_message::{AnswerSubmission, ClientMessage, HostAction, TeamAction};
use backend::model::server_message::{GameState, ServerMessage};
use backend::model::types::{
    McOptionType, NumericRangeType, NumericScoringMode, QuestionConfig, QuestionKind,
    QuestionPreset,
};

/// Send a host action and return the GameState the host gets back, draining the
/// broadcast every team receives too.
async fn host_action(
    host: &mut TestClient,
    teams: &mut [TestClient],
    action: HostAction,
) -> GameState {
    host.send_json(&ClientMessage::Host(action)).await;
    let response: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }
    match response {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    }
}

async fn join_teams(server: &TestServer, host: &mut TestClient, code: &str, names: &[&str]) -> Vec<TestClient> {
    let mut teams = Vec::new();
    for name in names {
        let mut team = TestClient::connect(&server.ws_url()).await;
        team.join_game(code, name).await;
        let _: ServerMessage = host.recv_json().await;
        teams.push(team);
    }
    teams
}

/// Submit a single-text answer; returns the host's resulting GameState.
async fn submit(
    host: &mut TestClient,
    teams: &mut [TestClient],
    index: usize,
    name: &str,
    answer: &str,
) -> GameState {
    teams[index]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: name.to_string(),
            answer: AnswerSubmission::Single(answer.to_string()),
        }))
        .await;
    let _: ServerMessage = teams[index].recv_json().await;
    match host.recv_json().await {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    }
}

fn numeric_preset() -> QuestionPreset {
    QuestionPreset {
        timer_duration: Some(45),
        question_points: Some(100),
        kind: Some(QuestionKind::Numeric),
        scoring_mode: Some(NumericScoringMode::Range),
        range_type: Some(NumericRangeType::Absolute),
        range_value: Some(1.0),
        numeric_correct_answer: Some(2015.0),
        ..Default::default()
    }
}

fn choice_preset() -> QuestionPreset {
    QuestionPreset {
        kind: Some(QuestionKind::MultipleChoice),
        option_type: Some(McOptionType::Letters),
        num_options: Some(3),
        answer_key: vec!["B".to_string()],
        ..Default::default()
    }
}

fn standard_preset(key: &str) -> QuestionPreset {
    QuestionPreset {
        answer_key: vec![key.to_string()],
        ..Default::default()
    }
}

fn set_deck(presets: Vec<QuestionPreset>, apply_to_current: bool) -> HostAction {
    HostAction::SetDeck {
        uuid: "deck0001".to_string(),
        presets,
        apply_to_current,
    }
}

#[tokio::test]
async fn game_without_a_deck_reports_none() {
    let server = TestServer::start().await;
    let (mut host, _code) = TestClient::connect_as_host_and_create_game(&server).await;

    let state = host_action(&mut host, &mut [], HostAction::NextQuestion).await;
    assert!(state.deck.is_none());
    assert!(matches!(state.questions[1].question_config, QuestionConfig::Standard));
    assert!(state.questions[1].answer_key.is_empty());
    assert_eq!(state.questions[1].timer_duration, 30);
}

#[tokio::test]
async fn attaching_a_deck_applies_the_first_preset_to_question_one() {
    let server = TestServer::start().await;
    let (mut host, _code) = TestClient::connect_as_host_and_create_game(&server).await;

    let state = host_action(
        &mut host,
        &mut [],
        set_deck(vec![numeric_preset(), choice_preset()], true),
    )
    .await;

    assert_eq!(state.deck.as_ref().unwrap().uuid, "deck0001");
    assert_eq!(state.deck.as_ref().unwrap().presets.len(), 2);

    let q1 = &state.questions[0];
    assert_eq!(q1.timer_duration, 45);
    assert_eq!(q1.question_points, 100);
    // Not declared by the deck, so the game default stands.
    assert_eq!(q1.bonus_increment, 5);
    assert_eq!(q1.numeric_correct_answer, Some(2015.0));
    match &q1.question_config {
        QuestionConfig::Numeric { config } => {
            assert_eq!(config.scoring_mode, NumericScoringMode::Range);
            assert_eq!(config.range_value, 1.0);
            // Left at the game's numeric default.
            assert_eq!(config.num_winners, 3);
        }
        other => panic!("Expected numeric config, got {other:?}"),
    }
    assert_eq!(state.timer_seconds_remaining, Some(45));
}

#[tokio::test]
async fn presets_shape_questions_as_they_are_created() {
    let server = TestServer::start().await;
    let (mut host, _code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(
        &mut host,
        &mut [],
        set_deck(vec![numeric_preset(), choice_preset()], true),
    )
    .await;

    let state = host_action(&mut host, &mut [], HostAction::NextQuestion).await;
    let q2 = &state.questions[1];
    match &q2.question_config {
        QuestionConfig::MultipleChoice { config } => {
            assert_eq!(config.option_type, McOptionType::Letters);
            assert_eq!(config.num_options, 3);
        }
        other => panic!("Expected multiple choice config, got {other:?}"),
    }
    assert_eq!(q2.answer_key, vec!["b".to_string()]);
    // Nothing declared for these, so game defaults.
    assert_eq!(q2.timer_duration, 30);
    assert_eq!(q2.question_points, 50);

    // Past the end of the deck, questions are plain defaults again.
    let state = host_action(&mut host, &mut [], HostAction::NextQuestion).await;
    let q3 = &state.questions[2];
    assert!(matches!(q3.question_config, QuestionConfig::Standard));
    assert!(q3.answer_key.is_empty());
}

#[tokio::test]
async fn answer_key_scores_matching_answers_and_leaves_the_rest() {
    let server = TestServer::start().await;
    let (mut host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(&mut host, &mut [], set_deck(vec![standard_preset("St. Louis")], true)).await;
    let mut teams = join_teams(&server, &mut host, &code, &["Team1", "Team2", "Team3"]).await;
    host_action(&mut host, &mut teams, HostAction::StartTimer).await;

    // Case and punctuation don't matter.
    let state = submit(&mut host, &mut teams, 0, "Team1", "  st louis!").await;
    assert_eq!(state.questions[0].answers[0].score.question_points, 50);
    let team1 = state.teams.iter().find(|t| t.team_name == "Team1").unwrap();
    assert_eq!(team1.score.question_points, 50);

    // A different answer is left for the host.
    let state = submit(&mut host, &mut teams, 1, "Team2", "Saint Louis").await;
    assert_eq!(state.questions[0].answers[1].score.question_points, 0);

    // The host can still score it by hand, and identical answers follow as before.
    let state = host_action(
        &mut host,
        &mut teams,
        HostAction::ScoreAnswer {
            question_number: 1,
            team_name: "Team2".to_string(),
            score: backend::model::types::ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
                speed_bonus_points: 0,
            },
        },
    )
    .await;
    assert_eq!(state.questions[0].answers[1].score.question_points, 50);
}

#[tokio::test]
async fn answer_key_is_never_sent_to_teams() {
    let server = TestServer::start().await;
    let (mut host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(&mut host, &mut [], set_deck(vec![standard_preset("Paris")], true)).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.send_json(&ClientMessage::Team(TeamAction::ValidateJoin {
        team_name: "Team1".to_string(),
        game_code: code.clone(),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    team.send_json(&ClientMessage::Team(TeamAction::JoinGame {
        game_code: code,
        team_name: "Team1".to_string(),
        color_hex: "#DC2626".to_string(),
        color_name: "Red".to_string(),
        team_members: vec!["Player".to_string()],
    }))
    .await;
    // Raw JSON, so a field leaking under any name would be seen.
    let raw: serde_json::Value = team.recv_json().await;
    let text = raw.to_string().to_lowercase();
    assert!(!text.contains("paris"), "team state leaked the answer: {text}");
    assert!(!text.contains("answerkey"));
    assert!(!text.contains("presets"));
}

#[tokio::test]
async fn multiple_choice_key_scores_the_right_letter() {
    let server = TestServer::start().await;
    let (mut host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(&mut host, &mut [], set_deck(vec![choice_preset()], true)).await;
    let mut teams = join_teams(&server, &mut host, &code, &["Team1", "Team2"]).await;
    host_action(&mut host, &mut teams, HostAction::StartTimer).await;

    let state = submit(&mut host, &mut teams, 0, "Team1", "B").await;
    assert_eq!(state.questions[0].answers[0].score.question_points, 50);
    let state = submit(&mut host, &mut teams, 1, "Team2", "C").await;
    assert_eq!(state.questions[0].answers[1].score.question_points, 0);
}

#[tokio::test]
async fn numeric_preset_scores_on_arrival() {
    let server = TestServer::start().await;
    let (mut host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(&mut host, &mut [], set_deck(vec![numeric_preset()], true)).await;
    let mut teams = join_teams(&server, &mut host, &code, &["Team1", "Team2"]).await;
    host_action(&mut host, &mut teams, HostAction::StartTimer).await;

    let state = submit(&mut host, &mut teams, 0, "Team1", "2015").await;
    assert_eq!(state.questions[0].answers[0].score.question_points, 100);
    // Outside ±1.
    let state = submit(&mut host, &mut teams, 1, "Team2", "2012").await;
    assert_eq!(state.questions[0].answers[1].score.question_points, 0);
}

#[tokio::test]
async fn multi_answer_preset_grades_against_the_deck() {
    let server = TestServer::start().await;
    let (mut host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    let preset = QuestionPreset {
        kind: Some(QuestionKind::MultiAnswer),
        num_answers: Some(2),
        multi_answer_correct_set: vec!["Mars".to_string(), "Venus".to_string()],
        ..Default::default()
    };
    host_action(&mut host, &mut [], set_deck(vec![preset], true)).await;
    let mut teams = join_teams(&server, &mut host, &code, &["Team1"]).await;
    host_action(&mut host, &mut teams, HostAction::StartTimer).await;

    teams[0]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team1".to_string(),
            answer: AnswerSubmission::Multi(vec!["mars".to_string(), "Pluto".to_string()]),
        }))
        .await;
    let _: ServerMessage = teams[0].recv_json().await;
    let state = match host.recv_json().await {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    };
    // One of two correct: half the points.
    assert_eq!(state.questions[0].answers[0].score.question_points, 25);
}

#[tokio::test]
async fn reloading_a_deck_leaves_existing_questions_alone() {
    let server = TestServer::start().await;
    let (mut host, _code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(&mut host, &mut [], set_deck(vec![numeric_preset(), choice_preset()], true)).await;

    // A live edit on question 1.
    host_action(
        &mut host,
        &mut [],
        HostAction::UpdateQuestionSettings {
            question_number: 1,
            timer_duration: 99,
            question_points: 100,
            bonus_increment: 5,
            question_type: QuestionKind::Numeric,
            speed_bonus_enabled: false,
        },
    )
    .await;

    // Reload with different content for both questions.
    let mut changed = numeric_preset();
    changed.timer_duration = Some(10);
    let state = host_action(
        &mut host,
        &mut [],
        set_deck(vec![changed, standard_preset("Mars")], false),
    )
    .await;
    // Question 1 keeps its live state.
    assert_eq!(state.questions[0].timer_duration, 99);

    // Question 2 hasn't been opened yet, so it takes the reloaded preset.
    let state = host_action(&mut host, &mut [], HostAction::NextQuestion).await;
    assert!(matches!(state.questions[1].question_config, QuestionConfig::Standard));
    assert_eq!(state.questions[1].answer_key, vec!["mars".to_string()]);
}

#[tokio::test]
async fn first_preset_is_not_applied_once_the_game_is_underway() {
    let server = TestServer::start().await;
    let (mut host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    let mut teams = join_teams(&server, &mut host, &code, &["Team1"]).await;
    host_action(&mut host, &mut teams, HostAction::StartTimer).await;
    submit(&mut host, &mut teams, 0, "Team1", "anything").await;

    let state = host_action(&mut host, &mut teams, set_deck(vec![numeric_preset()], true)).await;
    assert!(state.deck.is_some());
    assert!(matches!(state.questions[0].question_config, QuestionConfig::Standard));
    assert_eq!(state.questions[0].timer_duration, 30);
}

#[tokio::test]
async fn changing_game_defaults_keeps_deck_values_on_unanswered_questions() {
    let server = TestServer::start().await;
    let (mut host, _code) = TestClient::connect_as_host_and_create_game(&server).await;
    let state = host_action(&mut host, &mut [], set_deck(vec![numeric_preset()], true)).await;
    let settings = state.game_settings;

    let state = host_action(
        &mut host,
        &mut [],
        HostAction::UpdateGameSettings {
            default_timer_duration: 20,
            default_question_points: settings.default_question_points,
            default_bonus_increment: 7,
            default_question_type: settings.default_question_type,
            default_mc_config: settings.default_mc_config,
            default_multi_answer_config: settings.default_multi_answer_config,
            default_numeric_config: settings.default_numeric_config,
            default_map_config: settings.default_map_config,
            speed_bonus_enabled: settings.speed_bonus_enabled,
            speed_bonus_num_teams: settings.speed_bonus_num_teams,
            speed_bonus_first_place_points: settings.speed_bonus_first_place_points,
        },
    )
    .await;

    let q1 = &state.questions[0];
    // Declared by the deck: unchanged.
    assert_eq!(q1.timer_duration, 45);
    assert_eq!(q1.numeric_correct_answer, Some(2015.0));
    assert!(matches!(q1.question_config, QuestionConfig::Numeric { .. }));
    // Not declared by the deck: follows the new default.
    assert_eq!(q1.bonus_increment, 7);
}

#[tokio::test]
async fn deck_survives_a_host_reconnect() {
    let server = TestServer::start().await;
    let token = crate::create_host_token();
    let mut host = TestClient::connect_with_token(&server.ws_url(), Some(&token)).await;
    let code = host.create_game().await;
    host_action(&mut host, &mut [], set_deck(vec![numeric_preset()], true)).await;
    drop(host);
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let mut again = TestClient::connect_with_token(&server.ws_url(), Some(&token)).await;
    again
        .send_json(&ClientMessage::Host(HostAction::CreateGame {
            game_code: Some(code),
        }))
        .await;
    match again.recv_json().await {
        ServerMessage::GameState { state } => {
            assert_eq!(state.deck.unwrap().uuid, "deck0001");
            assert_eq!(state.questions[0].timer_duration, 45);
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn watchers_follow_the_slides_and_see_how_many_teams_answered() {
    let server = TestServer::start().await;
    let (mut host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(&mut host, &mut [], set_deck(vec![standard_preset("Paris")], true)).await;

    // A watcher joining mid-game is told where the slides are straight away.
    host_action(
        &mut host,
        &mut [],
        HostAction::SetDeckCursor {
            slide_index: 3,
            revealed: false,
            question_number: None,
        },
    )
    .await;
    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher
        .send_json(&ClientMessage::Watcher(
            backend::model::client_message::WatcherAction::WatchGame {
                game_code: code.clone(),
            },
        ))
        .await;
    match watcher.recv_json().await {
        ServerMessage::ScoreboardData { data } => {
            let cursor = data.deck.expect("deck cursor");
            assert_eq!(cursor.uuid, "deck0001");
            assert_eq!(cursor.slide_index, 3);
            assert!(!cursor.revealed);
            assert_eq!(data.current_question_number, 1);
            assert_eq!(data.answers_received, 0);
        }
        other => panic!("Expected ScoreboardData, got {other:?}"),
    }

    // Moves are pushed to watchers, and the host sees them echoed.
    let state = host_action(
        &mut host,
        &mut [],
        HostAction::SetDeckCursor {
            slide_index: 3,
            revealed: true,
            question_number: None,
        },
    )
    .await;
    assert!(state.deck.as_ref().unwrap().revealed);
    match watcher.recv_json().await {
        ServerMessage::ScoreboardData { data } => assert!(data.deck.unwrap().revealed),
        other => panic!("Expected ScoreboardData, got {other:?}"),
    }

    // Reloading the same deck keeps the slides where they are.
    let state = host_action(&mut host, &mut [], set_deck(vec![standard_preset("Mars")], false)).await;
    let deck = state.deck.unwrap();
    assert_eq!((deck.slide_index, deck.revealed), (3, true));
    // ...and bumps the version so displays re-read it.
    assert_eq!(deck.version, 2);
}

#[tokio::test]
async fn slides_and_question_move_together() {
    let server = TestServer::start().await;
    let (mut host, _code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(
        &mut host,
        &mut [],
        set_deck(vec![standard_preset("Paris"), choice_preset()], true),
    )
    .await;

    // Forward onto question 2's slide: the question is created from its preset.
    let state = host_action(
        &mut host,
        &mut [],
        HostAction::SetDeckCursor {
            slide_index: 5,
            revealed: false,
            question_number: Some(2),
        },
    )
    .await;
    assert_eq!(state.current_question_number, 2);
    assert_eq!(state.questions.len(), 2);
    assert!(matches!(
        state.questions[1].question_config,
        QuestionConfig::MultipleChoice { .. }
    ));
    assert_eq!(state.deck.as_ref().unwrap().slide_index, 5);

    // Back onto question 1's revealed slide.
    let state = host_action(
        &mut host,
        &mut [],
        HostAction::SetDeckCursor {
            slide_index: 3,
            revealed: true,
            question_number: Some(1),
        },
    )
    .await;
    assert_eq!(state.current_question_number, 1);
    assert_eq!(state.questions.len(), 2);

    // Skipping ahead past unopened questions is refused, and nothing moves.
    host.send_json(&ClientMessage::Host(HostAction::SetDeckCursor {
        slide_index: 9,
        revealed: false,
        question_number: Some(4),
    }))
    .await;
    match host.recv_json().await {
        ServerMessage::Error { message, .. } => assert!(message.contains("can't be opened yet")),
        other => panic!("Expected Error, got {other:?}"),
    }
    let state = host_action(&mut host, &mut [], HostAction::StartTimer).await;
    assert_eq!(state.deck.as_ref().unwrap().slide_index, 3);
    assert_eq!(state.current_question_number, 1);
}

#[tokio::test]
async fn moving_the_slides_needs_a_deck() {
    let server = TestServer::start().await;
    let (mut host, _code) = TestClient::connect_as_host_and_create_game(&server).await;
    host.send_json(&ClientMessage::Host(HostAction::SetDeckCursor {
        slide_index: 1,
        revealed: false,
        question_number: None,
    }))
    .await;
    match host.recv_json().await {
        ServerMessage::Error { message, .. } => assert!(message.contains("No deck")),
        other => panic!("Expected Error, got {other:?}"),
    }
}

#[tokio::test]
async fn scoreboard_without_a_deck_has_no_cursor() {
    let server = TestServer::start().await;
    let (_host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher
        .send_json(&ClientMessage::Watcher(
            backend::model::client_message::WatcherAction::WatchGame { game_code: code },
        ))
        .await;
    let raw: serde_json::Value = watcher.recv_json().await;
    assert!(raw["data"].get("deck").is_none(), "unexpected deck in {raw}");
}

#[tokio::test]
async fn watchers_hear_about_each_answer() {
    let server = TestServer::start().await;
    let (mut host, code) = TestClient::connect_as_host_and_create_game(&server).await;
    host_action(&mut host, &mut [], set_deck(vec![standard_preset("Paris")], true)).await;
    let mut teams = join_teams(&server, &mut host, &code, &["Team1", "Team2"]).await;

    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&code).await;

    host_action(&mut host, &mut teams, HostAction::PauseTimer).await;
    let _: ServerMessage = watcher.recv_json().await;

    // Submissions are open only while the timer runs; start it, then answer.
    host_action(&mut host, &mut teams, HostAction::StartTimer).await;
    let _: ServerMessage = watcher.recv_json().await;
    submit(&mut host, &mut teams, 0, "Team1", "Paris").await;

    // Skip any timer ticks; the next scoreboard update reports the answer and
    // the points it earned from the key.
    loop {
        match watcher.recv_json().await {
            ServerMessage::ScoreboardData { data } => {
                assert_eq!(data.answers_received, 1);
                let team1 = data.teams.iter().find(|t| t.team_name == "Team1").unwrap();
                assert_eq!(team1.score.question_points, 50);
                break;
            }
            ServerMessage::TimerTick { .. } => continue,
            other => panic!("Expected ScoreboardData, got {other:?}"),
        }
    }
}
