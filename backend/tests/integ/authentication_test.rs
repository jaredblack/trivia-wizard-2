use crate::{TestClient, TestServer, create_expired_token, create_non_host_token};

use backend::model::client_message::{ClientMessage, HostAction};
use backend::model::server_message::ServerMessage;

#[tokio::test]
async fn host_without_token_cannot_create_game() {
    let server = TestServer::start().await;
    let mut client = TestClient::connect(&server.ws_url()).await;

    client
        .send_json(&ClientMessage::Host(HostAction::CreateGame {
            game_code: None,
        }))
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
        .send_json(&ClientMessage::Host(HostAction::CreateGame {
            game_code: None,
        }))
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
        .send_json(&ClientMessage::Host(HostAction::CreateGame {
            game_code: None,
        }))
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
