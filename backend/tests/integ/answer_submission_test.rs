use crate::{TestClient, TestServer, assert_answer_submission_flow};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;

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
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await; // consume GameState

    assert_answer_submission_flow(&mut team, &mut host, "Test Team", "42").await;
}
