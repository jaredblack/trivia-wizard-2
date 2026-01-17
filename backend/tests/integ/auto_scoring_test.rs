use crate::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::ScoreData;

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
        // Consume the GameState broadcast to host when team joined
        let _: ServerMessage = host.recv_json().await;
        teams.push(team);
    }

    (host, game_code, teams)
}

/// Start the timer (opens submissions)
async fn start_timer(host: &mut TestClient, teams: &mut [TestClient]) {
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }
}

/// Pause the timer (stops ticks but keeps submissions open)
async fn pause_timer(host: &mut TestClient, teams: &mut [TestClient]) {
    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }
}

/// Helper to submit an answer and consume the response messages
/// Only the submitting team and host receive messages
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
            answer: answer.to_string(),
        }))
        .await;

    // Only the submitting team gets TeamGameState
    let _: ServerMessage = teams[team_index].recv_json().await;
    // Host gets GameState
    let _: ServerMessage = host.recv_json().await;
}

/// Helper to score an answer and return the resulting GameState
/// Note: Timer should be paused before calling this to avoid TimerTick interference
async fn score_answer(
    host: &mut TestClient,
    teams: &mut [TestClient],
    question_number: usize,
    team_name: &str,
    question_points: i32,
    bonus_points: i32,
) -> backend::model::server_message::GameState {
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number,
        team_name: team_name.to_string(),
        score: ScoreData {
            question_points,
            bonus_points,
            override_points: 0,
        },
    }))
    .await;

    // Host receives GameState
    let host_response: ServerMessage = host.recv_json().await;

    // All teams receive TeamGameState
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }

    match host_response {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn scoring_correct_auto_scores_matching_answers() {
    let server = TestServer::start().await;
    let (mut host, _game_code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2", "Team3"]).await;

    // Start timer for submissions
    start_timer(&mut host, &mut teams).await;

    // Team1 and Team3 submit the same answer, Team2 submits different
    submit_answer(&mut teams, &mut host, 0, "Team1", "Steve").await;
    submit_answer(&mut teams, &mut host, 1, "Team2", "Martin").await;
    submit_answer(&mut teams, &mut host, 2, "Team3", "Steve").await;

    // Pause timer before scoring
    pause_timer(&mut host, &mut teams).await;

    // Score Team1 as correct (50 points is the default question_points)
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 50, 10).await;

    // Verify Team1 has full score (with bonus)
    let team1_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team1")
        .unwrap();
    assert_eq!(team1_answer.score.question_points, 50);
    assert_eq!(team1_answer.score.bonus_points, 10);

    // Verify Team3 was auto-scored (question_points only, no bonus)
    let team3_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team3")
        .unwrap();
    assert_eq!(team3_answer.score.question_points, 50);
    assert_eq!(team3_answer.score.bonus_points, 0, "Auto-scored answers should not get bonus points");

    // Verify Team2 was NOT auto-scored (different answer)
    let team2_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team2")
        .unwrap();
    assert_eq!(team2_answer.score.question_points, 0);
    assert_eq!(team2_answer.score.bonus_points, 0);

    // Verify team totals
    let team1 = state.teams.iter().find(|t| t.team_name == "Team1").unwrap();
    let team3 = state.teams.iter().find(|t| t.team_name == "Team3").unwrap();
    assert_eq!(team1.score.question_points, 50);
    assert_eq!(team1.score.bonus_points, 10);
    assert_eq!(team3.score.question_points, 50);
    assert_eq!(team3.score.bonus_points, 0);
}

#[tokio::test]
async fn auto_scoring_is_case_insensitive_and_trims_whitespace() {
    let server = TestServer::start().await;
    let (mut host, _game_code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2", "Team3"]).await;

    start_timer(&mut host, &mut teams).await;

    // Submit answers with different casing and whitespace
    submit_answer(&mut teams, &mut host, 0, "Team1", "Steve").await;
    submit_answer(&mut teams, &mut host, 1, "Team2", "  STEVE  ").await;
    submit_answer(&mut teams, &mut host, 2, "Team3", "sTeVe").await;

    pause_timer(&mut host, &mut teams).await;

    // Score Team1 as correct
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 50, 0).await;

    // All three should be scored
    for team_name in &["Team1", "Team2", "Team3"] {
        let answer = state.questions[0]
            .answers
            .iter()
            .find(|a| &a.team_name == team_name)
            .unwrap();
        assert_eq!(
            answer.score.question_points, 50,
            "{team_name} should have been auto-scored"
        );
    }
}

#[tokio::test]
async fn clearing_score_clears_matching_answers() {
    let server = TestServer::start().await;
    let (mut host, _game_code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    start_timer(&mut host, &mut teams).await;

    // Both teams submit same answer
    submit_answer(&mut teams, &mut host, 0, "Team1", "Answer").await;
    submit_answer(&mut teams, &mut host, 1, "Team2", "Answer").await;

    pause_timer(&mut host, &mut teams).await;

    // Score Team1 correct (auto-scores Team2)
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 50, 0).await;
    assert_eq!(state.questions[0].answers[0].score.question_points, 50);
    assert_eq!(state.questions[0].answers[1].score.question_points, 50);

    // Clear Team1's score (should also clear Team2)
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 0, 0).await;

    // Both should now have 0 points
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
    assert_eq!(team1_answer.score.question_points, 0);
    assert_eq!(team2_answer.score.question_points, 0);
}

#[tokio::test]
async fn new_submission_auto_scored_if_matches_existing_correct() {
    let server = TestServer::start().await;
    let (mut host, _game_code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    start_timer(&mut host, &mut teams).await;

    // Team1 submits first
    submit_answer(&mut teams, &mut host, 0, "Team1", "Answer").await;

    pause_timer(&mut host, &mut teams).await;

    // Score Team1 as correct
    let _state = score_answer(&mut host, &mut teams, 1, "Team1", 50, 5).await;

    // Resume timer for Team2's submission
    start_timer(&mut host, &mut teams).await;

    // Team2 submits the same answer AFTER Team1 was scored (lowercase to test case-insensitivity)
    submit_answer(&mut teams, &mut host, 1, "Team2", "answer").await;

    pause_timer(&mut host, &mut teams).await;

    // Trigger another state update to verify (score Team1 again with same score)
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 50, 5).await;

    // Team2 should have been auto-scored on submission
    let team2_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team2")
        .unwrap();
    assert_eq!(
        team2_answer.score.question_points, 50,
        "Team2 should have been auto-scored when submitting matching answer"
    );
    assert_eq!(
        team2_answer.score.bonus_points, 0,
        "Auto-scored answer should not get bonus"
    );
}

#[tokio::test]
async fn partial_points_do_not_trigger_auto_scoring() {
    let server = TestServer::start().await;
    let (mut host, _game_code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    start_timer(&mut host, &mut teams).await;

    // Both teams submit same answer
    submit_answer(&mut teams, &mut host, 0, "Team1", "Answer").await;
    submit_answer(&mut teams, &mut host, 1, "Team2", "Answer").await;

    pause_timer(&mut host, &mut teams).await;

    // Score Team1 with partial points (25 instead of 50)
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 25, 0).await;

    // Team1 should have 25 points
    let team1_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team1")
        .unwrap();
    assert_eq!(team1_answer.score.question_points, 25);

    // Team2 should NOT be auto-scored (partial points don't trigger auto-scoring)
    let team2_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team2")
        .unwrap();
    assert_eq!(
        team2_answer.score.question_points, 0,
        "Partial points should not trigger auto-scoring"
    );
}

#[tokio::test]
async fn different_answers_not_affected_by_auto_scoring() {
    let server = TestServer::start().await;
    let (mut host, _game_code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2", "Team3"]).await;

    start_timer(&mut host, &mut teams).await;

    // All teams submit different answers
    submit_answer(&mut teams, &mut host, 0, "Team1", "Apple").await;
    submit_answer(&mut teams, &mut host, 1, "Team2", "Banana").await;
    submit_answer(&mut teams, &mut host, 2, "Team3", "Cherry").await;

    pause_timer(&mut host, &mut teams).await;

    // Score Team1 correct
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 50, 0).await;

    // Only Team1 should be scored
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
    let team3_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team3")
        .unwrap();

    assert_eq!(team1_answer.score.question_points, 50);
    assert_eq!(team2_answer.score.question_points, 0);
    assert_eq!(team3_answer.score.question_points, 0);

    // Clear Team1's score - other teams should be unaffected
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 0, 0).await;

    let team2_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team2")
        .unwrap();
    let team3_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team3")
        .unwrap();
    assert_eq!(team2_answer.score.question_points, 0);
    assert_eq!(team3_answer.score.question_points, 0);
}

#[tokio::test]
async fn already_scored_answers_not_overwritten_by_auto_scoring() {
    let server = TestServer::start().await;
    let (mut host, _game_code, mut teams) = setup_game_with_teams(&server, &["Team1", "Team2"]).await;

    start_timer(&mut host, &mut teams).await;

    // Both teams submit same answer
    submit_answer(&mut teams, &mut host, 0, "Team1", "Answer").await;
    submit_answer(&mut teams, &mut host, 1, "Team2", "Answer").await;

    pause_timer(&mut host, &mut teams).await;

    // Score Team2 first with bonus points
    let _state = score_answer(&mut host, &mut teams, 1, "Team2", 50, 15).await;

    // Now score Team1 - Team2 should NOT be overwritten because they already have points
    let state = score_answer(&mut host, &mut teams, 1, "Team1", 50, 5).await;

    // Team2 should still have their original bonus points
    let team2_answer = state.questions[0]
        .answers
        .iter()
        .find(|a| a.team_name == "Team2")
        .unwrap();
    assert_eq!(team2_answer.score.question_points, 50);
    assert_eq!(
        team2_answer.score.bonus_points, 15,
        "Team2's bonus should not be overwritten"
    );
}
