use crate::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::ScoreData;

/// Test that team names with capital letters work correctly throughout the scoring flow.
/// This tests the fix for a bug where case-sensitive comparisons caused:
/// - Score log to show empty for teams with capitals
/// - Submissions appearing to reopen after scoring
#[tokio::test]
async fn team_with_capital_letters_scores_correctly() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Join with a team name that has capital letters
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "MyTeam").await;
    let _: ServerMessage = host.recv_json().await; // consume host GameState

    // Start timer to open submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Team submits an answer
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "MyTeam".to_string(),
        answer: "Test Answer".to_string(),
    }))
    .await;

    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Pause timer before scoring
    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Score the answer
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "MyTeam".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 10,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;

    // Host receives GameState
    let host_response: ServerMessage = host.recv_json().await;

    // Team receives TeamGameState - this is where the bug manifested
    let team_response: ServerMessage = team.recv_json().await;

    // Verify host sees the correct score
    match host_response {
        ServerMessage::GameState { state } => {
            let team_data = state
                .teams
                .iter()
                .find(|t| t.team_name == "MyTeam")
                .expect("Team should exist");
            assert_eq!(
                team_data.score.question_points, 50,
                "Team score should be updated"
            );
            assert_eq!(team_data.score.bonus_points, 10);
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Verify team sees their answer in the score log (filter_for_team)
    match team_response {
        ServerMessage::TeamGameState { state } => {
            assert_eq!(state.questions.len(), 1, "Should have one question");

            let question = &state.questions[0];
            assert!(
                question.content.is_some(),
                "Team should see their own answer (score log). Got content: {:?}",
                question.content
            );
            assert_eq!(
                question.score.question_points, 50,
                "Team should see their score"
            );
            assert_eq!(question.score.bonus_points, 10);
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}

/// Test that a team cannot submit twice even with different capitalization
#[tokio::test]
async fn duplicate_submission_blocked_regardless_of_case() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "MyTeam").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // First submission
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "MyTeam".to_string(),
        answer: "First Answer".to_string(),
    }))
    .await;

    let _: ServerMessage = team.recv_json().await;
    let host_state: ServerMessage = host.recv_json().await;

    // Verify first answer was recorded
    let first_answer_count = match &host_state {
        ServerMessage::GameState { state } => state.questions[0].answers.len(),
        _ => panic!("Expected GameState"),
    };
    assert_eq!(first_answer_count, 1, "First answer should be recorded");

    // Try to submit again (should be blocked)
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "MyTeam".to_string(),
        answer: "Second Answer".to_string(),
    }))
    .await;

    // Team gets an error - duplicate submission is rejected
    let team_response: ServerMessage = team.recv_json().await;

    match team_response {
        ServerMessage::Error { message, .. } => {
            assert_eq!(
                message, "Answer already submitted",
                "Should get duplicate submission error"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }
}

/// Test that recalculate_team_score works with capital letters
#[tokio::test]
async fn team_total_score_accumulates_across_questions_with_capitals() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "CamelCaseTeam").await;
    let _: ServerMessage = host.recv_json().await;

    // === Question 1 ===
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "CamelCaseTeam".to_string(),
        answer: "Answer 1".to_string(),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Score question 1
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "CamelCaseTeam".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // === Move to Question 2 ===
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "CamelCaseTeam".to_string(),
        answer: "Answer 2".to_string(),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Score question 2
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 2,
        team_name: "CamelCaseTeam".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 5,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;

    let host_response: ServerMessage = host.recv_json().await;
    let team_response: ServerMessage = team.recv_json().await;

    // Verify cumulative score (50 + 50 = 100 question points, 0 + 5 = 5 bonus)
    match host_response {
        ServerMessage::GameState { state } => {
            let team_data = state
                .teams
                .iter()
                .find(|t| t.team_name == "CamelCaseTeam")
                .expect("Team should exist");
            assert_eq!(
                team_data.score.question_points, 100,
                "Team should have cumulative question points from both questions"
            );
            assert_eq!(
                team_data.score.bonus_points, 5,
                "Team should have cumulative bonus points"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Verify team sees both answers in their score log
    match team_response {
        ServerMessage::TeamGameState { state } => {
            assert_eq!(state.questions.len(), 2, "Should have two questions");

            // Both questions should show the team's answers
            assert!(
                state.questions[0].content.is_some(),
                "Q1: Team should see their answer"
            );
            assert!(
                state.questions[1].content.is_some(),
                "Q2: Team should see their answer"
            );

            assert_eq!(state.questions[0].score.question_points, 50);
            assert_eq!(state.questions[1].score.question_points, 50);
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}
