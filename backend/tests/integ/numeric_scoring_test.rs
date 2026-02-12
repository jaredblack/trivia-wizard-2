use crate::{TestClient, TestServer};

use backend::model::client_message::{AnswerSubmission, ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::{
    NumericConfig, NumericRangeType, NumericScoringMode, QuestionConfig, QuestionKind, ScoreData,
};

/// Helper to set up a game with host and multiple teams, timer NOT started yet
async fn setup_game_with_teams(
    server: &TestServer,
    team_names: &[&str],
) -> (TestClient, String, Vec<TestClient>) {
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(server).await;

    let mut teams = Vec::new();
    for name in team_names {
        let mut team = TestClient::connect(&server.ws_url()).await;
        team.join_game(&game_code, name).await;
        let _: ServerMessage = host.recv_json().await;
        teams.push(team);
    }

    (host, game_code, teams)
}

/// Switch the current question to numeric type
async fn switch_to_numeric(host: &mut TestClient, teams: &mut [TestClient]) {
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Numeric,
        speed_bonus_enabled: false,
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }
}

/// Set the numeric correct answer
async fn set_correct_answer(
    host: &mut TestClient,
    teams: &mut [TestClient],
    question_number: usize,
    correct_answer: Option<f64>,
) -> backend::model::server_message::GameState {
    host.send_json(&ClientMessage::Host(HostAction::SetNumericCorrectAnswer {
        question_number,
        correct_answer,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }

    match response {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    }
}

/// Update the numeric config (scoring mode, range, etc.)
async fn update_numeric_config(
    host: &mut TestClient,
    teams: &mut [TestClient],
    config: NumericConfig,
) -> backend::model::server_message::GameState {
    host.send_json(&ClientMessage::Host(
        HostAction::UpdateTypeSpecificSettings {
            question_number: 1,
            question_config: QuestionConfig::Numeric { config },
        },
    ))
    .await;

    let response: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }

    match response {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    }
}

/// Start the timer
async fn start_timer(host: &mut TestClient, teams: &mut [TestClient]) {
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }
}

/// Submit a numeric answer
async fn submit_answer(
    teams: &mut [TestClient],
    host: &mut TestClient,
    team_index: usize,
    team_name: &str,
    answer: &str,
) {
    teams[team_index]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: team_name.to_string(),
            answer: AnswerSubmission::Single(answer.to_string()),
        }))
        .await;

    let _: ServerMessage = teams[team_index].recv_json().await;
    let _: ServerMessage = host.recv_json().await;
}

/// Submit the last team's answer (same as submit_answer - auto-pause is reflected in same messages)
async fn submit_answer_last_team(
    teams: &mut [TestClient],
    host: &mut TestClient,
    team_index: usize,
    team_name: &str,
    answer: &str,
) {
    submit_answer(teams, host, team_index, team_name, answer).await;
}

/// Score an answer (bonus-only for numeric)
async fn score_answer(
    host: &mut TestClient,
    teams: &mut [TestClient],
    question_number: usize,
    team_name: &str,
    bonus_points: i32,
) -> backend::model::server_message::GameState {
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number,
        team_name: team_name.to_string(),
        score: ScoreData {
            question_points: 0, // ignored for numeric
            bonus_points,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }

    match response {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    }
}

fn get_question_points(state: &backend::model::server_message::GameState, team_name: &str) -> i32 {
    state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == team_name)
        .unwrap()
        .score
        .question_points
}

// === Tests ===

#[tokio::test]
async fn numeric_exact_scoring_correct_answer() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_numeric(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    submit_answer_last_team(&mut teams, &mut host, 0, "Team1", "42").await;

    // Set correct answer - should auto-score
    let state = set_correct_answer(&mut host, &mut teams, 1, Some(42.0)).await;

    assert_eq!(get_question_points(&state, "Team1"), 50);
}

#[tokio::test]
async fn numeric_exact_scoring_wrong_answer() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_numeric(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    submit_answer_last_team(&mut teams, &mut host, 0, "Team1", "43").await;

    let state = set_correct_answer(&mut host, &mut teams, 1, Some(42.0)).await;

    assert_eq!(get_question_points(&state, "Team1"), 0);
}

#[tokio::test]
async fn numeric_range_scoring_linear_falloff() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) =
        setup_game_with_teams(&server, &["Team1", "Team2", "Team3"]).await;

    switch_to_numeric(&mut host, &mut teams).await;

    // Set range mode with absolute range of 10
    update_numeric_config(
        &mut host,
        &mut teams,
        NumericConfig {
            scoring_mode: NumericScoringMode::Range,
            range_type: NumericRangeType::Absolute,
            range_value: 10.0,
            num_winners: 3,
        },
    )
    .await;

    start_timer(&mut host, &mut teams).await;

    submit_answer(&mut teams, &mut host, 0, "Team1", "100").await;
    submit_answer(&mut teams, &mut host, 1, "Team2", "105").await;
    submit_answer_last_team(&mut teams, &mut host, 2, "Team3", "112").await;

    let state = set_correct_answer(&mut host, &mut teams, 1, Some(100.0)).await;

    // Team1: distance=0, points = floor(50 * 10/10) = 50
    assert_eq!(get_question_points(&state, "Team1"), 50);
    // Team2: distance=5, points = floor(50 * 5/10) = 25
    assert_eq!(get_question_points(&state, "Team2"), 25);
    // Team3: distance=12, >= max_distance(10), points = 0
    assert_eq!(get_question_points(&state, "Team3"), 0);
}

#[tokio::test]
async fn numeric_range_scoring_percent_mode() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    switch_to_numeric(&mut host, &mut teams).await;

    // Set range mode with percent: 10% of correct
    update_numeric_config(
        &mut host,
        &mut teams,
        NumericConfig {
            scoring_mode: NumericScoringMode::Range,
            range_type: NumericRangeType::Percent,
            range_value: 10.0,
            num_winners: 3,
        },
    )
    .await;

    start_timer(&mut host, &mut teams).await;

    // Correct answer will be 200, so 10% = 20 is max_distance
    submit_answer(&mut teams, &mut host, 0, "Team1", "210").await;
    submit_answer_last_team(&mut teams, &mut host, 1, "Team2", "225").await;

    let state = set_correct_answer(&mut host, &mut teams, 1, Some(200.0)).await;

    // Team1: distance=10, max_distance=20, points = floor(50 * 10/20) = 25
    assert_eq!(get_question_points(&state, "Team1"), 25);
    // Team2: distance=25, >= max_distance(20), points = 0
    assert_eq!(get_question_points(&state, "Team2"), 0);
}

#[tokio::test]
async fn numeric_closest_guess_basic() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) =
        setup_game_with_teams(&server, &["Team1", "Team2", "Team3", "Team4"]).await;

    switch_to_numeric(&mut host, &mut teams).await;

    // Set closest guess mode with M=3
    update_numeric_config(
        &mut host,
        &mut teams,
        NumericConfig {
            scoring_mode: NumericScoringMode::ClosestGuess,
            range_type: NumericRangeType::Absolute,
            range_value: 5.0,
            num_winners: 3,
        },
    )
    .await;

    start_timer(&mut host, &mut teams).await;

    // Submit answers at various distances from 100
    submit_answer(&mut teams, &mut host, 0, "Team1", "100").await; // distance 0
    submit_answer(&mut teams, &mut host, 1, "Team2", "105").await; // distance 5
    submit_answer(&mut teams, &mut host, 2, "Team3", "110").await; // distance 10
    submit_answer_last_team(&mut teams, &mut host, 3, "Team4", "150").await; // distance 50

    let state = set_correct_answer(&mut host, &mut teams, 1, Some(100.0)).await;

    // Rank 1 (Team1): 50 points
    assert_eq!(get_question_points(&state, "Team1"), 50);
    // Rank 2 (Team2): floor(50/2) = 25
    assert_eq!(get_question_points(&state, "Team2"), 25);
    // Rank 3 (Team3): floor(25/2) = 12
    assert_eq!(get_question_points(&state, "Team3"), 12);
    // Team4 doesn't make the cut (M=3 teams awarded)
    assert_eq!(get_question_points(&state, "Team4"), 0);
}

#[tokio::test]
async fn numeric_closest_guess_tie_handling() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) =
        setup_game_with_teams(&server, &["Team1", "Team2", "Team3", "Team4"]).await;

    switch_to_numeric(&mut host, &mut teams).await;

    // M=2, but if 3 teams tie for first, all 3 get points
    update_numeric_config(
        &mut host,
        &mut teams,
        NumericConfig {
            scoring_mode: NumericScoringMode::ClosestGuess,
            range_type: NumericRangeType::Absolute,
            range_value: 5.0,
            num_winners: 2,
        },
    )
    .await;

    start_timer(&mut host, &mut teams).await;

    // Teams 1-3 tied at distance 5, Team4 further away
    submit_answer(&mut teams, &mut host, 0, "Team1", "95").await;
    submit_answer(&mut teams, &mut host, 1, "Team2", "105").await;
    submit_answer(&mut teams, &mut host, 2, "Team3", "95").await;
    submit_answer_last_team(&mut teams, &mut host, 3, "Team4", "200").await;

    let state = set_correct_answer(&mut host, &mut teams, 1, Some(100.0)).await;

    // All three tied teams get 50 (rank 1 points), even though M=2
    assert_eq!(get_question_points(&state, "Team1"), 50);
    assert_eq!(get_question_points(&state, "Team2"), 50);
    assert_eq!(get_question_points(&state, "Team3"), 50);
    // Team4 gets 0 (teams_awarded=3 >= M=2, stop)
    assert_eq!(get_question_points(&state, "Team4"), 0);
}

#[tokio::test]
async fn numeric_correct_answer_change_recalculates() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    switch_to_numeric(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    submit_answer(&mut teams, &mut host, 0, "Team1", "42").await;
    submit_answer_last_team(&mut teams, &mut host, 1, "Team2", "50").await;

    // Set correct answer to 42 - Team1 gets full points
    let state = set_correct_answer(&mut host, &mut teams, 1, Some(42.0)).await;
    assert_eq!(get_question_points(&state, "Team1"), 50);
    assert_eq!(get_question_points(&state, "Team2"), 0);

    // Change correct answer to 50 - Team2 gets full points, Team1 loses
    let state = set_correct_answer(&mut host, &mut teams, 1, Some(50.0)).await;
    assert_eq!(get_question_points(&state, "Team1"), 0);
    assert_eq!(get_question_points(&state, "Team2"), 50);
}

#[tokio::test]
async fn numeric_scoring_mode_change_recalculates() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    switch_to_numeric(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    submit_answer(&mut teams, &mut host, 0, "Team1", "100").await;
    submit_answer_last_team(&mut teams, &mut host, 1, "Team2", "105").await;

    // Set correct answer in exact mode - only Team1 gets points
    let state = set_correct_answer(&mut host, &mut teams, 1, Some(100.0)).await;
    assert_eq!(get_question_points(&state, "Team1"), 50);
    assert_eq!(get_question_points(&state, "Team2"), 0);

    // Switch to range mode - Team2 should now get partial points
    let state = update_numeric_config(
        &mut host,
        &mut teams,
        NumericConfig {
            scoring_mode: NumericScoringMode::Range,
            range_type: NumericRangeType::Absolute,
            range_value: 10.0,
            num_winners: 3,
        },
    )
    .await;

    assert_eq!(get_question_points(&state, "Team1"), 50);
    assert_eq!(get_question_points(&state, "Team2"), 25); // distance=5, range=10
}

#[tokio::test]
async fn numeric_non_numeric_submission_rejected() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_numeric(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    // Submit non-numeric text - should be silently rejected (no state update)
    teams[0]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team1".to_string(),
            answer: AnswerSubmission::Single("not a number".to_string()),
        }))
        .await;

    // Host should NOT receive a GameState (submission was rejected)
    // Submit a valid answer to confirm the previous was ignored
    submit_answer_last_team(&mut teams, &mut host, 0, "Team1", "42").await;

    // The answer should be 42, not "not a number"
    let state = set_correct_answer(&mut host, &mut teams, 1, Some(42.0)).await;
    assert_eq!(get_question_points(&state, "Team1"), 50);
}

#[tokio::test]
async fn numeric_bonus_points_work() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_numeric(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    submit_answer_last_team(&mut teams, &mut host, 0, "Team1", "42").await;

    // Set correct answer
    let _state = set_correct_answer(&mut host, &mut teams, 1, Some(42.0)).await;

    // Add bonus points
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 10).await;

    let answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team1")
        .unwrap();
    assert_eq!(answer.score.question_points, 50); // Preserved from numeric scoring
    assert_eq!(answer.score.bonus_points, 10);
}

#[tokio::test]
async fn numeric_speed_bonus_applies() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    // Switch to numeric with speed bonus enabled
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Numeric,
        speed_bonus_enabled: true,
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }

    start_timer(&mut host, &mut teams).await;

    submit_answer(&mut teams, &mut host, 0, "Team1", "42").await;
    submit_answer_last_team(&mut teams, &mut host, 1, "Team2", "42").await;

    // Set correct answer - both teams correct, speed bonus should apply
    let state = set_correct_answer(&mut host, &mut teams, 1, Some(42.0)).await;

    let team1_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team1")
        .unwrap();
    let team2_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team2")
        .unwrap();

    assert_eq!(team1_answer.score.question_points, 50);
    assert_eq!(team2_answer.score.question_points, 50);
    // Speed bonus: Team1 submitted first, should get higher bonus
    assert!(
        team1_answer.score.speed_bonus_points >= team2_answer.score.speed_bonus_points,
        "First submitter should get >= speed bonus"
    );
}

#[tokio::test]
async fn numeric_clearing_correct_answer_resets_scores() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_numeric(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    submit_answer_last_team(&mut teams, &mut host, 0, "Team1", "42").await;

    // Set correct answer
    let state = set_correct_answer(&mut host, &mut teams, 1, Some(42.0)).await;
    assert_eq!(get_question_points(&state, "Team1"), 50);

    // Clear correct answer
    let state = set_correct_answer(&mut host, &mut teams, 1, None).await;
    assert_eq!(get_question_points(&state, "Team1"), 0);
}
