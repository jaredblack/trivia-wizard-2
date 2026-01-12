use crate::{TestClient, TestServer, assert_answer_submission_flow};

use backend::model::client_message::{ClientMessage, HostAction};
use backend::model::server_message::ServerMessage;

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
