use crate::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;

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
    team.send_json(&ClientMessage::Host(HostAction::CreateGame {
        game_code: None,
    }))
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
