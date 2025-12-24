use crate::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;

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
