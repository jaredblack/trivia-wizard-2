use crate::{TestClient, TestServer};

use backend::model::client_message::{AnswerSubmission, ClientMessage, HostAction, TeamAction};
use backend::model::server_message::{GameState, ServerMessage};
use backend::model::types::{AnswerContent, MapConfig, QuestionConfig, QuestionKind, ScoreData};

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

/// Switch the current question to Map type
async fn switch_to_map(host: &mut TestClient, teams: &mut [TestClient]) -> GameState {
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Map,
        speed_bonus_enabled: false,
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

/// Set the map correct location and (via recalc) score all answers
async fn set_correct_location(
    host: &mut TestClient,
    teams: &mut [TestClient],
    question_number: usize,
    correct_location: Option<(f64, f64)>,
) -> GameState {
    host.send_json(&ClientMessage::Host(HostAction::SetMapCorrectLocation {
        question_number,
        correct_location,
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

/// Update the map config (full_points_distance_km, one_point_distance_km)
async fn update_map_config(
    host: &mut TestClient,
    teams: &mut [TestClient],
    config: MapConfig,
) -> GameState {
    host.send_json(&ClientMessage::Host(
        HostAction::UpdateTypeSpecificSettings {
            question_number: 1,
            question_config: QuestionConfig::Map { config },
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

/// Submit map coordinates
async fn submit_coords(
    teams: &mut [TestClient],
    host: &mut TestClient,
    team_index: usize,
    team_name: &str,
    lat: f64,
    lng: f64,
) {
    teams[team_index]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: team_name.to_string(),
            answer: AnswerSubmission::Coordinates { lat, lng },
        }))
        .await;

    let _: ServerMessage = teams[team_index].recv_json().await;
    let _: ServerMessage = host.recv_json().await;
}

fn get_answer<'a>(state: &'a GameState, team_name: &str) -> &'a backend::model::types::Answer {
    state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == team_name)
        .expect("team answer should exist")
}

fn get_question_points(state: &GameState, team_name: &str) -> i32 {
    get_answer(state, team_name).score.question_points
}

// === Tests ===

#[tokio::test]
async fn map_switch_question_type_broadcasts_to_teams_and_watchers() {
    let server = TestServer::start().await;
    let (mut host, game_code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&game_code).await;

    let state = switch_to_map(&mut host, &mut teams).await;

    // Host state: Q1 is now a Map question with default config
    assert_eq!(state.questions[0].question_config.kind(), QuestionKind::Map);
    match &state.questions[0].question_config {
        QuestionConfig::Map { config } => {
            assert_eq!(config.full_points_distance_km, 0.025);
            assert_eq!(config.one_point_distance_km, 10000.0);
        }
        other => panic!("Expected Map config, got {other:?}"),
    }

    // Watcher receives a scoreboard update (no questions in it, but timer state is)
    let _: ServerMessage = watcher.recv_json().await;
}

#[tokio::test]
async fn map_correct_location_set_after_submission_triggers_scoring() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    switch_to_map(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    // Statue of Liberty
    let target = (40.6892, -74.0445);

    // Team1: exact match (within full_points_distance_km)
    submit_coords(&mut teams, &mut host, 0, "Team1", target.0, target.1).await;
    // Team2: far away (~3935km from NYC; well into the decay zone)
    submit_coords(&mut teams, &mut host, 1, "Team2", 34.0522, -118.2437).await;

    let state = set_correct_location(&mut host, &mut teams, 1, Some(target)).await;

    assert_eq!(get_question_points(&state, "Team1"), 50);
    let team2_pts = get_question_points(&state, "Team2");
    assert!(
        team2_pts >= 0 && team2_pts < 50,
        "Far-away team should have partial/zero points, got {team2_pts}"
    );
}

#[tokio::test]
async fn map_submission_after_correct_location_set_auto_scores() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_map(&mut host, &mut teams).await;

    let target = (40.6892, -74.0445);
    // Set correct location *before* any submissions
    set_correct_location(&mut host, &mut teams, 1, Some(target)).await;

    start_timer(&mut host, &mut teams).await;

    submit_coords(&mut teams, &mut host, 0, "Team1", target.0, target.1).await;

    // After submitting, query state via score-no-op (score_answer with zero bonus)
    // Simpler: nav to Q2 and back, then check. Actually easiest: just submit -> auto-pause
    // also fires, so let's pause-then-read by sending pause. But timer auto-paused already.
    // Instead, request fresh state by toggling speed bonus on/off (cheap). Easier path:
    // submit and assert on the host's GameState that's broadcast on submission.
    // Re-issue: we already consumed the GameState. Use ResetTimer to grab a fresh one.
    host.send_json(&ClientMessage::Host(HostAction::ResetTimer))
        .await;
    let response: ServerMessage = host.recv_json().await;
    let _: ServerMessage = teams[0].recv_json().await;

    let state = match response {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    };
    assert_eq!(get_question_points(&state, "Team1"), 50);
}

#[tokio::test]
async fn map_correct_location_change_recalculates() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    switch_to_map(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    let nyc = (40.6892, -74.0445);
    let la = (34.0522, -118.2437);

    submit_coords(&mut teams, &mut host, 0, "Team1", nyc.0, nyc.1).await;
    submit_coords(&mut teams, &mut host, 1, "Team2", la.0, la.1).await;

    // Correct = NYC. Team1 wins.
    let state = set_correct_location(&mut host, &mut teams, 1, Some(nyc)).await;
    assert_eq!(get_question_points(&state, "Team1"), 50);
    assert!(get_question_points(&state, "Team2") < 50);

    // Move correct to LA. Team2 wins, Team1 loses.
    let state = set_correct_location(&mut host, &mut teams, 1, Some(la)).await;
    assert!(get_question_points(&state, "Team1") < 50);
    assert_eq!(get_question_points(&state, "Team2"), 50);
}

#[tokio::test]
async fn map_clearing_correct_location_resets_scores() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_map(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    let target = (40.6892, -74.0445);
    submit_coords(&mut teams, &mut host, 0, "Team1", target.0, target.1).await;

    let state = set_correct_location(&mut host, &mut teams, 1, Some(target)).await;
    assert_eq!(get_question_points(&state, "Team1"), 50);

    let state = set_correct_location(&mut host, &mut teams, 1, None).await;
    assert_eq!(get_question_points(&state, "Team1"), 0);
}

#[tokio::test]
async fn map_out_of_range_coordinates_rejected() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_map(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    // Out-of-range lat
    teams[0]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team1".to_string(),
            answer: AnswerSubmission::Coordinates {
                lat: 95.0,
                lng: 0.0,
            },
        }))
        .await;

    // Team gets an error response (submit_answer returns false → error)
    let response: ServerMessage = teams[0].recv_json().await;
    assert!(
        matches!(response, ServerMessage::Error { .. }),
        "Expected Error for out-of-range lat, got {response:?}"
    );

    // Out-of-range lng
    teams[0]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team1".to_string(),
            answer: AnswerSubmission::Coordinates {
                lat: 0.0,
                lng: 200.0,
            },
        }))
        .await;
    let response: ServerMessage = teams[0].recv_json().await;
    assert!(matches!(response, ServerMessage::Error { .. }));

    // Valid submission still works afterwards
    submit_coords(&mut teams, &mut host, 0, "Team1", 40.6892, -74.0445).await;
    let state = set_correct_location(&mut host, &mut teams, 1, Some((40.6892, -74.0445))).await;
    assert_eq!(get_question_points(&state, "Team1"), 50);
}

#[tokio::test]
async fn map_rejects_wrong_submission_type() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_map(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    // Submit a Single (text) answer to a Map question
    teams[0]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team1".to_string(),
            answer: AnswerSubmission::Single("New York".to_string()),
        }))
        .await;

    let response: ServerMessage = teams[0].recv_json().await;
    assert!(
        matches!(response, ServerMessage::Error { .. }),
        "Expected Error for text submission on Map question, got {response:?}"
    );
}

#[tokio::test]
async fn map_config_change_post_submission_recalculates() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_map(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    // Team1 submits at a location ~111km from the correct (1 degree of latitude)
    let correct = (40.0, -74.0);
    let guess = (41.0, -74.0);
    submit_coords(&mut teams, &mut host, 0, "Team1", guess.0, guess.1).await;
    let state = set_correct_location(&mut host, &mut teams, 1, Some(correct)).await;

    let initial_pts = get_question_points(&state, "Team1");
    // With default config (one_point_distance_km=10000), ~111km gets a high score
    assert!(
        initial_pts > 0 && initial_pts < 50,
        "Expected partial points with default config, got {initial_pts}"
    );

    // Tighten config: full_points_distance very small, one_point at 50km — guess is far beyond
    let state = update_map_config(
        &mut host,
        &mut teams,
        MapConfig {
            full_points_distance_km: 0.025,
            one_point_distance_km: 50.0,
        },
    )
    .await;
    let tight_pts = get_question_points(&state, "Team1");
    assert!(
        tight_pts < initial_pts,
        "Tighter config should reduce score: initial={initial_pts}, tight={tight_pts}"
    );

    // Loosen config: full points within 200km — guess gets full points
    let state = update_map_config(
        &mut host,
        &mut teams,
        MapConfig {
            full_points_distance_km: 200.0,
            one_point_distance_km: 10000.0,
        },
    )
    .await;
    assert_eq!(get_question_points(&state, "Team1"), 50);
}

#[tokio::test]
async fn map_speed_bonus_applies_in_submission_order() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    // Switch to map with speed bonus enabled
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Map,
        speed_bonus_enabled: true,
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }

    let target = (40.6892, -74.0445);
    set_correct_location(&mut host, &mut teams, 1, Some(target)).await;
    start_timer(&mut host, &mut teams).await;

    // Both teams hit the exact correct location (full points → speed-bonus eligible)
    submit_coords(&mut teams, &mut host, 0, "Team1", target.0, target.1).await;
    submit_coords(&mut teams, &mut host, 1, "Team2", target.0, target.1).await;

    // Trigger a fresh broadcast (resetTimer is fine since timer auto-paused already)
    host.send_json(&ClientMessage::Host(HostAction::ResetTimer))
        .await;
    let response: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }
    let state = match response {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    };

    let t1 = get_answer(&state, "Team1");
    let t2 = get_answer(&state, "Team2");
    assert_eq!(t1.score.question_points, 50);
    assert_eq!(t2.score.question_points, 50);
    assert!(
        t1.score.speed_bonus_points >= t2.score.speed_bonus_points,
        "First submitter should get >= speed bonus"
    );
    assert!(
        t1.score.speed_bonus_points > 0,
        "First submitter should get a non-zero speed bonus"
    );
}

#[tokio::test]
async fn map_manual_bonus_preserves_auto_computed_question_points() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_map(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    let target = (40.6892, -74.0445);
    submit_coords(&mut teams, &mut host, 0, "Team1", target.0, target.1).await;
    let state = set_correct_location(&mut host, &mut teams, 1, Some(target)).await;
    assert_eq!(get_question_points(&state, "Team1"), 50);

    // Host applies manual bonus. question_points field in the request should be ignored
    // (Map flows through the bonus-only branch in score_answer like Numeric/MultiAnswer).
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Team1".to_string(),
        score: ScoreData {
            question_points: 9999, // should be ignored
            bonus_points: 10,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let response: ServerMessage = host.recv_json().await;
    let _: ServerMessage = teams[0].recv_json().await;

    let state = match response {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    };
    let answer = get_answer(&state, "Team1");
    assert_eq!(
        answer.score.question_points, 50,
        "question_points should remain the auto-computed value"
    );
    assert_eq!(answer.score.bonus_points, 10);
}

#[tokio::test]
async fn map_watcher_receives_update_on_score_change() {
    let server = TestServer::start().await;
    let (mut host, game_code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_map(&mut host, &mut teams).await;

    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&game_code).await;

    start_timer(&mut host, &mut teams).await;
    // Drain timer-start scoreboard update on watcher
    let _: ServerMessage = watcher.recv_json().await;

    let target = (40.6892, -74.0445);
    submit_coords(&mut teams, &mut host, 0, "Team1", target.0, target.1).await;
    set_correct_location(&mut host, &mut teams, 1, Some(target)).await;

    // Drain TimerTicks to find the ScoreboardData with non-zero team score
    loop {
        let msg: ServerMessage = watcher.recv_json().await;
        match msg {
            ServerMessage::TimerTick { .. } => continue,
            ServerMessage::ScoreboardData { data } => {
                let team = data
                    .teams
                    .iter()
                    .find(|t| t.team_name == "Team1")
                    .expect("Team1 should be in scoreboard");
                if team.score.question_points == 50 {
                    break;
                }
                // Watcher might receive intermediate updates (e.g., from submission with no
                // correct location yet). Keep draining until we see the scored state.
            }
            other => panic!("Expected ScoreboardData or TimerTick, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn map_team_question_config_preserved_across_navigation() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_game_with_teams(&server, &["Team1"]).await;

    switch_to_map(&mut host, &mut teams).await;
    start_timer(&mut host, &mut teams).await;

    let target = (40.6892, -74.0445);
    submit_coords(&mut teams, &mut host, 0, "Team1", target.0, target.1).await;
    set_correct_location(&mut host, &mut teams, 1, Some(target)).await;

    // Navigate to Q2
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = teams[0].recv_json().await;

    // Navigate back to Q1
    host.send_json(&ClientMessage::Host(HostAction::PrevQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let team_msg: ServerMessage = teams[0].recv_json().await;

    // Verify the team sees Q1 as Map type with their submitted coordinates and full score
    match team_msg {
        ServerMessage::TeamGameState { state } => {
            let q1 = &state.questions[0];
            assert_eq!(q1.question_config.kind(), QuestionKind::Map);
            assert_eq!(q1.score.question_points, 50);
            match &q1.content {
                Some(AnswerContent::Coordinates { lat, lng }) => {
                    assert!((lat - target.0).abs() < 1e-9);
                    assert!((lng - target.1).abs() < 1e-9);
                }
                other => panic!("Expected Coordinates content, got {other:?}"),
            }
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}
