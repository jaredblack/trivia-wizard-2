use crate::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;

#[tokio::test]
async fn timer_start_opens_submissions_and_broadcasts_state() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Start timer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
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
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
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

    // Start timer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
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

    // Start timer (uses question's default timer_duration of 30s)
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;

    // Both should receive initial GameState
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Both should receive timer ticks (check first 2 ticks)
    for expected_remaining in [29, 28] {
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

    // Note: Full timer expiration testing requires UpdateQuestionSettings to set shorter durations
}

#[tokio::test]
async fn submissions_rejected_after_timer_expires() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Consume the GameState broadcast to host when team joined
    let _: ServerMessage = host.recv_json().await;

    // Start timer (uses question's default timer_duration of 30s)
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await; // consume initial GameState
    let _: ServerMessage = team.recv_json().await; // consume initial TeamGameState

    // Wait for timer to expire (30 seconds)
    for _ in 0..30 {
        let _: ServerMessage = host.recv_json().await;
        let _: ServerMessage = team.recv_json().await;
    }

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

    // Start timer (uses question's default timer_duration of 30s)
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await; // consume initial GameState

    // Wait for one tick
    let tick: ServerMessage = host.recv_json().await;
    match tick {
        ServerMessage::TimerTick { seconds_remaining } => {
            assert_eq!(seconds_remaining, 29);
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
