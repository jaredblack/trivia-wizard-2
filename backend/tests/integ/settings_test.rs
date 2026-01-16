use crate::{TestClient, TestServer, default_mc_config};
use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::QuestionKind;

#[tokio::test]
async fn update_game_settings_changes_defaults() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Update game settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 60,
        default_question_points: 100,
        default_bonus_increment: 10,
        default_question_type: QuestionKind::MultipleChoice,
        default_mc_config: default_mc_config(),
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.game_settings.default_timer_duration, 60);
            assert_eq!(state.game_settings.default_question_points, 100);
            assert_eq!(state.game_settings.default_bonus_increment, 10);
            assert_eq!(
                state.game_settings.default_question_type,
                QuestionKind::MultipleChoice
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn update_game_settings_propagates_to_unanswered_questions() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Create a second question by navigating
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;

    // Update game settings - both Q1 and Q2 are unanswered
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 45,
        default_question_points: 75,
        default_bonus_increment: 15,
        default_question_type: QuestionKind::Standard,
        default_mc_config: default_mc_config(),
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            // Both questions should be updated
            assert_eq!(state.questions[0].timer_duration, 45);
            assert_eq!(state.questions[0].question_points, 75);
            assert_eq!(state.questions[0].bonus_increment, 15);

            assert_eq!(state.questions[1].timer_duration, 45);
            assert_eq!(state.questions[1].question_points, 75);
            assert_eq!(state.questions[1].bonus_increment, 15);

            // Timer display should also be updated
            assert_eq!(state.timer_seconds_remaining, Some(45));
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn update_game_settings_does_not_change_answered_questions() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Join a team
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer on Q1 to enable submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Team submits an answer on Q1
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: "My answer".to_string(),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Create Q2 (unanswered)
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Get Q1's original settings
    let q1_original_timer = 30u32; // Default timer duration

    // Update game settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 90,
        default_question_points: 200,
        default_bonus_increment: 25,
        default_question_type: QuestionKind::Standard,
        default_mc_config: default_mc_config(),
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            // Q1 (has answers) should NOT be updated
            assert_eq!(
                state.questions[0].timer_duration, q1_original_timer,
                "Q1 timer should NOT change because it has answers"
            );

            // Q2 (no answers) SHOULD be updated
            assert_eq!(
                state.questions[1].timer_duration, 90,
                "Q2 timer should be updated to new default"
            );
            assert_eq!(state.questions[1].question_points, 200);
            assert_eq!(state.questions[1].bonus_increment, 25);
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn update_question_settings_changes_specific_question() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Update Q1's settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 120,
        question_points: 150,
        bonus_increment: 20,
        question_type: QuestionKind::MultiAnswer,
        mc_config: None,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.questions[0].timer_duration, 120);
            assert_eq!(state.questions[0].question_points, 150);
            assert_eq!(state.questions[0].bonus_increment, 20);

            // Question type should change
            assert_eq!(
                state.questions[0].question_kind,
                QuestionKind::MultiAnswer,
                "Question kind should be MultiAnswer"
            );

            // Timer display should be updated
            assert_eq!(state.timer_seconds_remaining, Some(120));
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn update_question_settings_fails_when_question_has_answers() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Join a team
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer to enable submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Team submits an answer
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: "My answer".to_string(),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Try to update Q1's settings (should fail)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 60,
        question_points: 100,
        bonus_increment: 10,
        question_type: QuestionKind::Standard,
        mc_config: None,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("has answers"),
                "Error should mention that question has answers, got: {message}"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }
}

#[tokio::test]
async fn update_question_settings_fails_for_nonexistent_question() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Try to update Q99 (doesn't exist)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 99,
        timer_duration: 60,
        question_points: 100,
        bonus_increment: 10,
        question_type: QuestionKind::Standard,
        mc_config: None,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("does not exist"),
                "Error should mention question doesn't exist, got: {message}"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }
}

#[tokio::test]
async fn settings_changes_broadcast_to_teams() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Join a team
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Update game settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 45,
        default_question_points: 75,
        default_bonus_increment: 15,
        default_question_type: QuestionKind::Standard,
        default_mc_config: default_mc_config(),
    }))
    .await;

    let _: ServerMessage = host.recv_json().await;
    let team_response: ServerMessage = team.recv_json().await;

    match team_response {
        ServerMessage::TeamGameState { .. } => {
            // Team received the broadcast
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}

#[tokio::test]
async fn new_questions_use_updated_game_settings() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Update game settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 90,
        default_question_points: 200,
        default_bonus_increment: 25,
        default_question_type: QuestionKind::MultipleChoice,
        default_mc_config: default_mc_config(),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;

    // Navigate to create a new question
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            // The new Q2 should use the updated defaults
            assert_eq!(state.questions[1].timer_duration, 90);
            assert_eq!(state.questions[1].question_points, 200);
            assert_eq!(state.questions[1].bonus_increment, 25);

            assert_eq!(
                state.questions[1].question_kind,
                QuestionKind::MultipleChoice,
                "Question kind should be MultipleChoice"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}
