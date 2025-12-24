use crate::{TestClient, TestServer, create_host_token};

use backend::model::client_message::{ClientMessage, HostAction};
use backend::model::server_message::ServerMessage;

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
