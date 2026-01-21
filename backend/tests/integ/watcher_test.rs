use crate::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, HostAction, TeamAction, WatcherAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::ScoreData;

#[tokio::test]
async fn watcher_receives_initial_scoreboard_data() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Add a team first
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await; // consume host update

    // Connect watcher
    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&game_code).await;
}

#[tokio::test]
async fn watcher_receives_error_for_invalid_game_code() {
    let server = TestServer::start().await;

    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher
        .send_json(&ClientMessage::Watcher(WatcherAction::WatchGame {
            game_code: "INVALID".to_string(),
        }))
        .await;

    let response: ServerMessage = watcher.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("not found"),
                "Error message should mention game not found"
            );
        }
        other => panic!("Expected Error message, got {other:?}"),
    }
}

#[tokio::test]
async fn watcher_receives_update_when_team_joins() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Connect watcher first
    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&game_code).await;

    // Team joins
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Consume host update
    let _: ServerMessage = host.recv_json().await;

    // Watcher should receive scoreboard update with the new team
    let watcher_response: ServerMessage = watcher.recv_json().await;
    match watcher_response {
        ServerMessage::ScoreboardData { data } => {
            assert_eq!(data.teams.len(), 1, "Should have one team");
            assert_eq!(data.teams[0].team_name, "Test Team");
        }
        other => panic!("Expected ScoreboardData message, got {other:?}"),
    }
}

#[tokio::test]
async fn watcher_receives_update_when_score_changes() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Team joins
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await; // consume host update from team join

    // Connect watcher
    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&game_code).await;

    // Start timer to open submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await; // consume GameState
    let _: ServerMessage = watcher.recv_json().await; // consume watcher update from timer start

    // Team submits answer
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: "42".to_string(),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await; // consume TeamGameState
    let _: ServerMessage = host.recv_json().await; // consume GameState

    // Note: answer submission doesn't change score yet, so no watcher update

    // Host scores the answer
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Test Team".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;

    // Host receives update
    let _: ServerMessage = host.recv_json().await;

    // Team receives update
    let _: ServerMessage = team.recv_json().await;

    // Watcher should receive scoreboard update with the new score
    let watcher_response: ServerMessage = watcher.recv_json().await;
    match watcher_response {
        ServerMessage::ScoreboardData { data } => {
            assert_eq!(data.teams.len(), 1, "Should have one team");
            assert_eq!(data.teams[0].team_name, "Test Team");
            assert_eq!(
                data.teams[0].score.question_points, 50,
                "Score should be updated"
            );
        }
        other => panic!("Expected ScoreboardData message, got {other:?}"),
    }
}

#[tokio::test]
async fn multiple_watchers_receive_updates() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Connect two watchers
    let mut watcher1 = TestClient::connect(&server.ws_url()).await;
    watcher1.watch_game(&game_code).await;

    let mut watcher2 = TestClient::connect(&server.ws_url()).await;
    watcher2.watch_game(&game_code).await;

    // Team joins
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Consume host update
    let _: ServerMessage = host.recv_json().await;

    // Both watchers should receive the update
    let watcher1_response: ServerMessage = watcher1.recv_json().await;
    match watcher1_response {
        ServerMessage::ScoreboardData { data } => {
            assert_eq!(data.teams.len(), 1);
        }
        other => panic!("Expected ScoreboardData message for watcher1, got {other:?}"),
    }

    let watcher2_response: ServerMessage = watcher2.recv_json().await;
    match watcher2_response {
        ServerMessage::ScoreboardData { data } => {
            assert_eq!(data.teams.len(), 1);
        }
        other => panic!("Expected ScoreboardData message for watcher2, got {other:?}"),
    }
}

#[tokio::test]
async fn watcher_receives_update_when_team_score_override() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Team joins
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Connect watcher
    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&game_code).await;

    // Host overrides team score
    host.send_json(&ClientMessage::Host(HostAction::OverrideTeamScore {
        team_name: "Test Team".to_string(),
        override_points: 100,
    }))
    .await;

    // Host receives update
    let _: ServerMessage = host.recv_json().await;

    // Team receives update
    let _: ServerMessage = team.recv_json().await;

    // Watcher should receive scoreboard update
    let watcher_response: ServerMessage = watcher.recv_json().await;
    match watcher_response {
        ServerMessage::ScoreboardData { data } => {
            assert_eq!(data.teams[0].score.override_points, 100);
        }
        other => panic!("Expected ScoreboardData message, got {other:?}"),
    }
}
