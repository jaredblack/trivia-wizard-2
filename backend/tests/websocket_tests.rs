mod common;

use common::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::{HostServerMessage, ServerMessage, TeamServerMessage};

/// Helper function to test answer submission flow:
/// - Team submits answer
/// - Team receives AnswerSubmitted confirmation
/// - Host receives NewAnswer with correct details
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
        ServerMessage::Team(TeamServerMessage::AnswerSubmitted) => {
            // Success - team got confirmation
        }
        other => panic!("Expected AnswerSubmitted message, got {other:?}"),
    }

    // Host should receive the answer
    let host_response: ServerMessage = host.recv_json().await;
    match host_response {
        ServerMessage::Host(HostServerMessage::NewAnswer {
            answer: received_answer,
            team_name: received_team_name,
        }) => {
            assert_eq!(
                received_answer, answer,
                "Answer should match what team submitted"
            );
            assert_eq!(received_team_name, team_name, "Team name should match");
        }
        other => panic!("Expected NewAnswer message, got {other:?}"),
    }
}

#[tokio::test]
async fn host_creates_game_and_receives_game_code() {
    let server = TestServer::start().await;
    let mut host = TestClient::connect(&server.ws_url()).await;

    let game_code = host.create_game().await;

    assert!(!game_code.is_empty(), "Game code should not be empty");
}

#[tokio::test]
async fn team_joins_existing_game_and_receives_confirmation() {
    let server = TestServer::start().await;

    let mut host = TestClient::connect(&server.ws_url()).await;
    let game_code = host.create_game().await;

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
    }))
    .await;

    let response: ServerMessage = team.recv_json().await;

    match response {
        ServerMessage::Error(msg) => {
            assert!(
                msg.contains("nonexistent"),
                "Error should mention the game code"
            );
        }
        other => panic!("Expected Error message, got {other:?}"),
    }
}

#[tokio::test]
async fn multiple_teams_can_join_same_game() {
    let server = TestServer::start().await;

    let mut host = TestClient::connect(&server.ws_url()).await;
    let game_code = host.create_game().await;

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

    let mut host1 = TestClient::connect(&server.ws_url()).await;
    let game_code_1 = host1.create_game().await;

    let mut host2 = TestClient::connect(&server.ws_url()).await;
    let game_code_2 = host2.create_game().await;

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
async fn team_submits_answer_host_receives_it() {
    let server = TestServer::start().await;

    let mut host = TestClient::connect(&server.ws_url()).await;
    let game_code = host.create_game().await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    assert_answer_submission_flow(&mut team, &mut host, "Test Team", "42").await;
}

#[tokio::test]
async fn team_submits_answer_when_host_disconnected_receives_error() {
    let server = TestServer::start().await;

    let mut host = TestClient::connect(&server.ws_url()).await;
    let game_code = host.create_game().await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    drop(host);

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: "42".to_string(),
    }))
    .await;

    let response: ServerMessage = team.recv_json().await;
    match response {
        ServerMessage::Error(msg) => {
            assert!(
                msg.contains("Host is not connected") || msg.contains("not connected"),
                "Error should mention host not being connected, got: {msg}"
            );
        }
        other => panic!("Expected Error message, got {other:?}"),
    }
}

#[tokio::test]
async fn host_disconnects_and_reconnects_teams_remain() {
    let server = TestServer::start().await;

    let mut host = TestClient::connect(&server.ws_url()).await;
    let game_code = host.create_game().await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Host disconnects
    drop(host);

    // Give the server a moment to process the disconnection
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Host reconnects by creating a new connection and sending CreateGame
    // Note: will break for now if we remove the hardcoded game code
    let mut host = TestClient::connect(&server.ws_url()).await;
    let reconnected_game_code = host.create_game().await;

    // Verify we got the same game code back
    assert_eq!(
        game_code, reconnected_game_code,
        "Reconnected host should reclaim the same game"
    );

    // Verify the team can still submit answers and the reconnected host receives them
    assert_answer_submission_flow(&mut team, &mut host, "Test Team", "42").await;
}

#[tokio::test]
async fn invalid_json_message_returns_error() {
    let server = TestServer::start().await;

    let mut client = TestClient::connect(&server.ws_url()).await;

    // Send invalid JSON (not properly formatted)
    client.send_raw_text("{this is not valid json}").await;

    let response: ServerMessage = client.recv_json().await;
    match response {
        ServerMessage::Error(msg) => {
            assert!(
                msg.contains("parse") || msg.contains("invalid") || msg.contains("JSON"),
                "Error should mention parsing/invalid JSON, got: {msg}"
            );
        }
        other => panic!("Expected Error message for invalid JSON, got {other:?}"),
    }
}

#[tokio::test]
async fn host_sends_unexpected_message_type() {
    let server = TestServer::start().await;

    // First, connect as a host
    let mut host = TestClient::connect(&server.ws_url()).await;
    let _game_code = host.create_game().await;

    // Now send an unexpected Team message
    host.send_json(&ClientMessage::Team(TeamAction::JoinGame {
        game_code: "ABCD".to_string(),
        team_name: "Test Team".to_string(),
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error(_msg) => {
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

    // Create a game first so the team has something to join
    let mut host = TestClient::connect(&server.ws_url()).await;
    let game_code = host.create_game().await;

    // Connect as a team
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Now send an unexpected Host message
    team.send_json(&ClientMessage::Host(HostAction::CreateGame))
        .await;

    // Team should receive an error
    let response: ServerMessage = team.recv_json().await;
    match response {
        ServerMessage::Error(_msg) => {
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
    let mut host = TestClient::connect(&server.ws_url()).await;
    let _game_code = host.create_game().await;

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

    let mut host1 = TestClient::connect(&server.ws_url()).await;
    let _game_code = host1.create_game().await;

    drop(host1);

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let mut host2 = TestClient::connect(&server.ws_url()).await;
    let _game_code2 = host2.create_game().await;

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

    let mut host = TestClient::connect(&server.ws_url()).await;
    let game_code = host.create_game().await;

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
