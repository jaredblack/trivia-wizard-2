use crate::{TestClient, TestServer};
use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::{QuestionData, ScoreData};

#[tokio::test]
async fn next_question_increments_question_number_and_creates_new_question() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Navigate to next question
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.current_question_number, 2);
            assert_eq!(state.questions.len(), 2, "New question should be created");
            assert_eq!(
                state.timer_seconds_remaining,
                Some(state.questions[1].timer_duration),
                "Timer should reset to new question's duration"
            );
            assert!(!state.timer_running, "Timer should be stopped");
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn navigation_preserves_answers_and_scores_across_questions() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Join two teams
    let mut team1 = TestClient::connect(&server.ws_url()).await;
    team1.join_game(&game_code, "Team Alpha").await;
    let _: ServerMessage = host.recv_json().await; // consume team join broadcast

    let mut team2 = TestClient::connect(&server.ws_url()).await;
    team2.join_game(&game_code, "Team Beta").await;
    let _: ServerMessage = host.recv_json().await; // consume team join broadcast

    // Start timer on Q1 to open submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team1.recv_json().await;
    let _: ServerMessage = team2.recv_json().await;

    // Teams submit answers on Q1
    team1
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team Alpha".to_string(),
            answer: "Answer from Alpha on Q1".to_string(),
        }))
        .await;
    let _: ServerMessage = team1.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    team2
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team Beta".to_string(),
            answer: "Answer from Beta on Q1".to_string(),
        }))
        .await;
    let _: ServerMessage = team2.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Host scores Team Alpha's answer on Q1
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Team Alpha".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 10,
            override_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team1.recv_json().await;

    // Navigate to Q2
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team1.recv_json().await;
    let _: ServerMessage = team2.recv_json().await;

    // Start timer on Q2
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team1.recv_json().await;
    let _: ServerMessage = team2.recv_json().await;

    // Team Alpha submits on Q2
    team1
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team Alpha".to_string(),
            answer: "Answer from Alpha on Q2".to_string(),
        }))
        .await;
    let _: ServerMessage = team1.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Navigate back to Q1
    host.send_json(&ClientMessage::Host(HostAction::PrevQuestion))
        .await;

    let response: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team1.recv_json().await;
    let _: ServerMessage = team2.recv_json().await;

    // Verify Q1 still has both answers and Team Alpha's score
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.current_question_number, 1);
            assert_eq!(state.questions.len(), 2, "Should still have 2 questions");

            let q1_responses = match &state.questions[0].question_data {
                QuestionData::Standard { responses } => responses,
                other => panic!("Expected Standard question, got {other:?}"),
            };

            assert_eq!(q1_responses.len(), 2, "Q1 should have 2 answers");

            let alpha_response = q1_responses
                .iter()
                .find(|r| r.team_name == "Team Alpha")
                .expect("Team Alpha's answer should exist");
            assert_eq!(alpha_response.answer_text, "Answer from Alpha on Q1");
            assert_eq!(alpha_response.score.question_points, 50);
            assert_eq!(alpha_response.score.bonus_points, 10);

            let beta_response = q1_responses
                .iter()
                .find(|r| r.team_name == "Team Beta")
                .expect("Team Beta's answer should exist");
            assert_eq!(beta_response.answer_text, "Answer from Beta on Q1");
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Navigate forward to Q2 again
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;

    let response: ServerMessage = host.recv_json().await;

    // Verify Q2 still has Team Alpha's answer
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.current_question_number, 2);
            assert_eq!(state.questions.len(), 2, "Should not create Q3");

            let q2_responses = match &state.questions[1].question_data {
                QuestionData::Standard { responses } => responses,
                other => panic!("Expected Standard question, got {other:?}"),
            };

            assert_eq!(q2_responses.len(), 1, "Q2 should have 1 answer");
            assert_eq!(q2_responses[0].team_name, "Team Alpha");
            assert_eq!(q2_responses[0].answer_text, "Answer from Alpha on Q2");
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn prev_question_decrements_question_number() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Go to Q2 first
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;

    // Navigate back to Q1
    host.send_json(&ClientMessage::Host(HostAction::PrevQuestion))
        .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.current_question_number, 1);
            assert_eq!(
                state.timer_seconds_remaining,
                Some(state.questions[0].timer_duration),
                "Timer should reset to Q1's duration"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn prev_question_at_q1_returns_error() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Try to go before Q1
    host.send_json(&ClientMessage::Host(HostAction::PrevQuestion))
        .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("first question"),
                "Error should mention first question, got: {message}"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }
}

#[tokio::test]
async fn next_question_stops_running_timer() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Start timer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;

    // Navigate to next question while timer is running
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert!(
                !state.timer_running,
                "Timer should be stopped after navigation"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Verify no more timer ticks arrive
    let timeout_result = tokio::time::timeout(
        std::time::Duration::from_millis(1500),
        host.recv_json::<ServerMessage>(),
    )
    .await;

    assert!(
        timeout_result.is_err(),
        "Should not receive any more timer ticks after navigation"
    );
}

#[tokio::test]
async fn question_navigation_broadcasts_to_teams() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await; // consume team join broadcast

    // Navigate to next question
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;

    let _: ServerMessage = host.recv_json().await; // host gets GameState
    let team_response: ServerMessage = team.recv_json().await;

    match team_response {
        ServerMessage::TeamGameState { state } => {
            assert_eq!(state.current_question_number, 2);
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}
