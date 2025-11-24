mod common;

use common::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, TeamAction};
use backend::model::server_message::ServerMessage;

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

    // Host 1 creates a game
    let mut host1 = TestClient::connect(&server.ws_url()).await;
    let game_code_1 = host1.create_game().await;

    // Host 2 creates a game
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
