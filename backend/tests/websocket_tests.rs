mod common;

use common::{
    TestClient, TestServer, create_expired_token, create_host_token, create_non_host_token,
};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;

/// Helper function to test answer submission flow:
/// - Team submits answer
/// - Team receives TeamGameState confirmation
/// - Host receives GameState with the answer
/// Note: Requires timer to be running (submissions open)
async fn assert_answer_submission_flow(
    team: &mut TestClient,
    host: &mut TestClient,
    team_name: &str,
    answer: &str,
) {
    // Team submits an answer
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: team_name.to_string(),
        answer: answer.to_string(),
    }))
    .await;

    // Team should receive confirmation
    let team_response: ServerMessage = team.recv_json().await;
    match team_response {
        ServerMessage::TeamGameState { .. } => {
            // Success - team got state update
        }
        other => panic!("Expected TeamGameState message, got {other:?}"),
    }

    // Host should receive the updated game state
    let host_response: ServerMessage = host.recv_json().await;
    match host_response {
        ServerMessage::GameState { state } => {
            // Verify the answer was added to the current question
            let responses = match &state.current_question.question_data {
                backend::model::types::QuestionData::Standard { responses } => responses,
                _ => panic!("Expected Standard question type"),
            };
            assert!(
                responses
                    .iter()
                    .any(|r| r.team_name == team_name && r.answer_text == answer),
                "Answer should appear in responses"
            );
        }
        other => panic!("Expected GameState message, got {other:?}"),
    }
}

#[tokio::test]
async fn host_creates_game_and_receives_game_code() {
    let server = TestServer::start().await;
    let (_, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    assert!(!game_code.is_empty(), "Game code should not be empty");
}

#[tokio::test]
async fn team_joins_existing_game_and_receives_confirmation() {
    let server = TestServer::start().await;
    let (_, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
}

#[tokio::test]
async fn team_joins_nonexistent_game_receives_error() {
    let server = TestServer::start().await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.send_json(&ClientMessage::Team(TeamAction::JoinGame {
        game_code: "nonexistent".to_string(),
        team_name: "Test Team".to_string(),
        color_hex: "#DC2626".to_string(),
        team_members: vec!["Test Player".to_string()],
    }))
    .await;

    let response: ServerMessage = team.recv_json().await;

    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("nonexistent"),
                "Error should mention the game code"
            );
        }
        other => panic!("Expected Error message, got {other:?}"),
    }
}

#[tokio::test]
async fn multiple_teams_can_join_same_game() {
    let server = TestServer::start().await;
    let (_, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team1 = TestClient::connect(&server.ws_url()).await;
    team1.join_game(&game_code, "Team Alpha").await;

    let mut team2 = TestClient::connect(&server.ws_url()).await;
    team2.join_game(&game_code, "Team Beta").await;

    let mut team3 = TestClient::connect(&server.ws_url()).await;
    team3.join_game(&game_code, "Team Gamma").await;
}

#[tokio::test]
async fn multiple_hosts_and_teams_interleaved() {
    let server = TestServer::start().await;

    let (_, game_code_1) = TestClient::connect_as_host_and_create_game(&server).await;
    let (_, game_code_2) = TestClient::connect_as_host_and_create_game(&server).await;

    assert_ne!(
        game_code_1, game_code_2,
        "Each host should get a unique game code"
    );

    // Team joins game 2 first (out of order)
    let mut team_for_game2 = TestClient::connect(&server.ws_url()).await;
    team_for_game2
        .join_game(&game_code_2, "Team for Game 2")
        .await;

    // Now team joins game 1
    let mut team_for_game1 = TestClient::connect(&server.ws_url()).await;
    team_for_game1
        .join_game(&game_code_1, "Team for Game 1")
        .await;

    // Another team joins game 2
    let mut team2_for_game2 = TestClient::connect(&server.ws_url()).await;
    team2_for_game2
        .join_game(&game_code_2, "Second Team for Game 2")
        .await;
}

#[tokio::test]
async fn team_submission_rejected_when_submissions_closed() {
    let server = TestServer::start().await;
    let (_, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Try to submit answer when timer is not running (submissions closed)
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: "42".to_string(),
    }))
    .await;

    let response: ServerMessage = team.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("closed"),
                "Error should mention submissions being closed, got: {message}"
            );
        }
        other => panic!("Expected Error message, got {other:?}"),
    }
}

#[tokio::test]
async fn team_submits_answer_host_receives_it() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Consume the GameState broadcast to host when team joined
    let _: ServerMessage = host.recv_json().await;

    // Start timer to open submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer {
        seconds: None,
    }))
    .await;
    let _: ServerMessage = host.recv_json().await; // consume GameState

    assert_answer_submission_flow(&mut team, &mut host, "Test Team", "42").await;
}

#[tokio::test]
async fn host_disconnects_and_reconnects_teams_remain() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Host should receive GameState with the new team
    let host_update: ServerMessage = host.recv_json().await;
    match host_update {
        ServerMessage::GameState { state } => {
            assert_eq!(state.teams.len(), 1, "Should have 1 team");
            assert_eq!(state.teams[0].team_name, "Test Team");
        }
        other => panic!("Expected GameState with team, got {other:?}"),
    }

    // Host disconnects
    drop(host);

    // Give the server a moment to process the disconnection
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Host reconnects with a new token and reclaims the game
    let token = create_host_token();
    let mut host = TestClient::connect_with_token(&server.ws_url(), Some(&token)).await;
    host.send_json(&ClientMessage::Host(HostAction::ReclaimGame {
        game_code: game_code.clone(),
    }))
    .await;
    let response: ServerMessage = host.recv_json().await;
    let reconnected_game_code = match response {
        ServerMessage::GameState { state } => state.game_code,
        other => panic!("Didn't receive GameState when reclaiming game, got {other:?}"),
    };

    // Verify we got the same game code back
    assert_eq!(
        game_code, reconnected_game_code,
        "Reconnected host should reclaim the same game"
    );

    // TODO: Phase 2 - verify team can still submit answers
}

#[tokio::test]
async fn invalid_json_message_returns_error() {
    let server = TestServer::start().await;

    let mut client = TestClient::connect(&server.ws_url()).await;

    // Send invalid JSON (not properly formatted)
    client.send_raw_text("{this is not valid json}").await;

    let response: ServerMessage = client.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("parse")
                    || message.contains("invalid")
                    || message.contains("JSON"),
                "Error should mention parsing/invalid JSON, got: {message}"
            );
        }
        other => panic!("Expected Error message for invalid JSON, got {other:?}"),
    }
}

#[tokio::test]
async fn host_sends_unexpected_message_type() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Now send an unexpected Team message
    host.send_json(&ClientMessage::Team(TeamAction::JoinGame {
        game_code: "ABCD".to_string(),
        team_name: "Test Team".to_string(),
        color_hex: "#DC2626".to_string(),
        team_members: vec!["Test Player".to_string()],
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { .. } => {
            // Success - got an error for unexpected message type
        }
        other => {
            panic!("Expected Error message for unexpected Team message from Host, got {other:?}")
        }
    }
}

#[tokio::test]
async fn team_sends_unexpected_message_type() {
    let server = TestServer::start().await;
    let (_, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Connect as a team
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Now send an unexpected Host message
    team.send_json(&ClientMessage::Host(HostAction::CreateGame))
        .await;

    // Team should receive an error
    let response: ServerMessage = team.recv_json().await;
    match response {
        ServerMessage::Error { .. } => {
            // Success - got an error for unexpected message type
        }
        other => {
            panic!("Expected Error message for unexpected Host message from Team, got {other:?}")
        }
    }
}

#[tokio::test]
async fn timer_closes_server_when_all_hosts_disconnect() {
    // Use a very short shutdown duration for this test (500ms)
    let mut server =
        TestServer::start_with_shutdown_duration(std::time::Duration::from_millis(250)).await;

    // Host creates a game
    let (host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Host disconnects
    drop(host);

    // Wait for the shutdown timer to trigger
    // Use a timeout slightly longer than the shutdown duration
    let shutdown_result = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        server.shutdown_rx.recv(),
    )
    .await;

    assert!(
        shutdown_result.is_ok(),
        "Server should have shut down after host disconnected"
    );
    assert!(
        shutdown_result.unwrap().is_some(),
        "Shutdown signal should have been sent"
    );
}

#[tokio::test]
async fn timer_cancels_when_new_host_connects() {
    let mut server =
        TestServer::start_with_shutdown_duration(std::time::Duration::from_millis(500)).await;

    let (host1, _) = TestClient::connect_as_host_and_create_game(&server).await;

    drop(host1);

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let (_host2, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Wait past the original shutdown duration
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;

    // Verify shutdown did NOT happen
    let shutdown_result = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        server.shutdown_rx.recv(),
    )
    .await;

    assert!(
        shutdown_result.is_err(),
        "Server should NOT have shut down because a new host connected"
    );
}

#[tokio::test]
async fn timer_does_not_cancel_when_team_connects() {
    let mut server =
        TestServer::start_with_shutdown_duration(std::time::Duration::from_millis(500)).await;

    let (host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    drop(host);

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Team connects and joins the game (this should NOT cancel the timer)
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Wait for the shutdown timer to trigger
    let shutdown_result = tokio::time::timeout(
        std::time::Duration::from_millis(600),
        server.shutdown_rx.recv(),
    )
    .await;

    assert!(
        shutdown_result.is_ok(),
        "Server SHOULD shut down even though team connected after host disconnected"
    );
    assert!(
        shutdown_result.unwrap().is_some(),
        "Shutdown signal should have been sent"
    );
}

// ============== Authentication Tests ==============

#[tokio::test]
async fn host_without_token_cannot_create_game() {
    let server = TestServer::start().await;
    let mut client = TestClient::connect(&server.ws_url()).await;

    client
        .send_json(&ClientMessage::Host(HostAction::CreateGame))
        .await;

    let response: ServerMessage = client.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("Authentication required"),
                "Error should mention authentication required, got: {message}"
            );
        }
        other => panic!("Expected Error message, got {other:?}"),
    }
}

#[tokio::test]
async fn host_with_expired_token_cannot_create_game() {
    let server = TestServer::start().await;
    let token = create_expired_token();
    let mut client = TestClient::connect_with_token(&server.ws_url(), Some(&token)).await;

    client
        .send_json(&ClientMessage::Host(HostAction::CreateGame))
        .await;

    let response: ServerMessage = client.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("Authentication required"),
                "Error should mention authentication required for expired token, got: {message}"
            );
        }
        other => panic!("Expected Error message for expired token, got {other:?}"),
    }
}

#[tokio::test]
async fn user_not_in_hosts_group_cannot_create_game() {
    let server = TestServer::start().await;
    let token = create_non_host_token();
    let mut client = TestClient::connect_with_token(&server.ws_url(), Some(&token)).await;

    client
        .send_json(&ClientMessage::Host(HostAction::CreateGame))
        .await;

    let response: ServerMessage = client.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("not authorized as a host"),
                "Error should mention not authorized as host, got: {message}"
            );
        }
        other => panic!("Expected Error message for non-host user, got {other:?}"),
    }
}

#[tokio::test]
async fn team_can_join_without_token() {
    let server = TestServer::start().await;
    let (_, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Team connects without any token
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Unauthenticated Team").await;
    // If we get here without panic, the test passes
}

// ============== Timer Tests (Phase 3) ==============

#[tokio::test]
async fn timer_start_opens_submissions_and_broadcasts_state() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Start timer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer {
        seconds: None,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert!(state.timer_running, "Timer should be running");
            assert!(
                state.timer_seconds_remaining.is_some(),
                "Timer seconds should be set"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn timer_pause_closes_submissions() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Start timer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer {
        seconds: Some(30),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await; // consume GameState

    // Pause timer
    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert!(!state.timer_running, "Timer should not be running");
            assert!(
                state.timer_seconds_remaining.is_some(),
                "Timer seconds should still be set"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn timer_reset_stops_timer_and_resets_to_default() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Start timer with custom duration
    host.send_json(&ClientMessage::Host(HostAction::StartTimer {
        seconds: Some(15),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await; // consume GameState

    // Reset timer
    host.send_json(&ClientMessage::Host(HostAction::ResetTimer))
        .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert!(!state.timer_running, "Timer should not be running");
            assert_eq!(
                state.timer_seconds_remaining,
                Some(30),
                "Timer should reset to 30 seconds"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn timer_ticks_broadcast_to_all_clients() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Consume the GameState broadcast to host when team joined
    let _: ServerMessage = host.recv_json().await;

    // Start timer with short duration
    host.send_json(&ClientMessage::Host(HostAction::StartTimer {
        seconds: Some(3),
    }))
    .await;

    // Both should receive initial GameState
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Both should receive timer ticks
    for expected_remaining in [2, 1] {
        let host_tick: ServerMessage = host.recv_json().await;
        let team_tick: ServerMessage = team.recv_json().await;

        match host_tick {
            ServerMessage::TimerTick { seconds_remaining } => {
                assert_eq!(seconds_remaining, expected_remaining);
            }
            other => panic!("Host expected TimerTick, got {other:?}"),
        }

        match team_tick {
            ServerMessage::TimerTick { seconds_remaining } => {
                assert_eq!(seconds_remaining, expected_remaining);
            }
            other => panic!("Team expected TimerTick, got {other:?}"),
        }
    }

    // When timer reaches 0, both should receive GameState with timer_running = false
    let host_final: ServerMessage = host.recv_json().await;
    let team_final: ServerMessage = team.recv_json().await;

    match host_final {
        ServerMessage::GameState { state } => {
            assert!(!state.timer_running, "Timer should have stopped");
            assert_eq!(state.timer_seconds_remaining, Some(0));
        }
        other => panic!("Host expected final GameState, got {other:?}"),
    }

    match team_final {
        ServerMessage::TeamGameState { state } => {
            assert!(!state.timer_running, "Timer should have stopped");
            assert_eq!(state.timer_seconds_remaining, Some(0));
        }
        other => panic!("Team expected final TeamGameState, got {other:?}"),
    }
}

#[tokio::test]
async fn submissions_rejected_after_timer_expires() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Consume the GameState broadcast to host when team joined
    let _: ServerMessage = host.recv_json().await;

    // Start timer with 1 second
    host.send_json(&ClientMessage::Host(HostAction::StartTimer {
        seconds: Some(1),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await; // consume initial GameState
    let _: ServerMessage = team.recv_json().await; // consume initial TeamGameState

    // Wait for timer to expire
    // Expect final GameState when timer reaches 0
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Now try to submit answer - should be rejected
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: "42".to_string(),
    }))
    .await;

    let response: ServerMessage = team.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("closed"),
                "Error should mention submissions being closed, got: {message}"
            );
        }
        other => panic!("Expected Error message, got {other:?}"),
    }
}

#[tokio::test]
async fn timer_pause_prevents_further_ticks() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Start timer with longer duration
    host.send_json(&ClientMessage::Host(HostAction::StartTimer {
        seconds: Some(10),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await; // consume initial GameState

    // Wait for one tick
    let tick: ServerMessage = host.recv_json().await;
    match tick {
        ServerMessage::TimerTick { seconds_remaining } => {
            assert_eq!(seconds_remaining, 9);
        }
        other => panic!("Expected TimerTick, got {other:?}"),
    }

    // Pause the timer
    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;
    let _: ServerMessage = host.recv_json().await; // consume GameState from pause

    // Wait a bit and verify no more ticks arrive
    let timeout_result = tokio::time::timeout(
        std::time::Duration::from_millis(1500),
        host.recv_json::<ServerMessage>(),
    )
    .await;

    assert!(
        timeout_result.is_err(),
        "Should not receive any more messages after pause"
    );
}
