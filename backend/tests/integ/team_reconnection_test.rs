use crate::{TestClient, TestServer};

use backend::model::client_message::{ClientMessage, HostAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::ScoreData;

#[tokio::test]
async fn team_reconnects_and_score_persists() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Team A joins game
    let mut team_a = TestClient::connect(&server.ws_url()).await;
    team_a.join_game(&game_code, "Test Team A").await;

    // Host should receive GameState with the new team
    let _host_update: ServerMessage = host.recv_json().await;

    // Host allows answers by starting timer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await; // consume GameState from StartTimer

    // Team A answers
    team_a
        .send_json(&ClientMessage::Team(
            backend::model::client_message::TeamAction::SubmitAnswer {
                team_name: "Test Team A".to_string(),
                answer: "Answer 42".to_string(),
            },
        ))
        .await;

    // Consume answer submission messages
    let _: ServerMessage = team_a.recv_json().await; // TeamGameState
    let _: ServerMessage = host.recv_json().await; // GameState with answer

    // Host scores team A's answer
    let score = ScoreData {
        question_points: 50,
        bonus_points: 10,
        override_points: 0,
    };
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Test Team A".to_string(),
        score,
    }))
    .await;

    // Consume scoring messages
    let _: ServerMessage = host.recv_json().await; // GameState with score

    // Host closes answers by pausing timer
    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;
    let _: ServerMessage = host.recv_json().await; // GameState from PauseTimer

    // Team A disconnects
    drop(team_a);

    // Give the server a moment to process the disconnection
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Host should receive update about team disconnection
    let host_update: ServerMessage = host.recv_json().await;
    match host_update {
        ServerMessage::GameState { state } => {
            assert_eq!(state.teams.len(), 1, "Should still have 1 team");
            assert_eq!(state.teams[0].team_name, "Test Team A");
            assert!(!state.teams[0].connected, "Team should be disconnected");
        }
        other => panic!("Expected GameState with disconnected team, got {other:?}"),
    }

    // Team A reconnects by sending JoinGame message again
    let mut team_a_reconnected = TestClient::connect(&server.ws_url()).await;
    team_a_reconnected
        .join_game(&game_code, "Test Team A")
        .await;

    // Host should receive GameState showing team reconnected
    let host_update: ServerMessage = host.recv_json().await;
    match host_update {
        ServerMessage::GameState { state } => {
            assert_eq!(state.teams.len(), 1, "Should have exactly 1 team");
            let team = &state.teams[0];
            assert_eq!(team.team_name, "Test Team A");
            assert!(team.connected, "Team should be connected");

            // Verify score persisted
            assert_eq!(
                team.score.question_points, 50,
                "Question points should persist after reconnection"
            );
            assert_eq!(
                team.score.bonus_points, 10,
                "Bonus points should persist after reconnection"
            );
            assert_eq!(
                team.score.override_points, 0,
                "Override points should persist after reconnection"
            );
        }
        other => panic!("Expected GameState with reconnected team, got {other:?}"),
    }
}
