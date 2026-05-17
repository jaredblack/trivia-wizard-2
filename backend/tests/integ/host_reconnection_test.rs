use crate::{TestClient, TestServer, create_host_token};

use backend::model::client_message::{AnswerSubmission, ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::ScoreData;

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
    host.send_json(&ClientMessage::Host(HostAction::CreateGame {
        game_code: Some(game_code.clone()),
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
}

#[tokio::test]
async fn team_can_submit_and_be_scored_after_host_reconnect() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await; // consume join broadcast

    // Host disconnects
    drop(host);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Host reconnects and reclaims the game
    let token = create_host_token();
    let mut host = TestClient::connect_with_token(&server.ws_url(), Some(&token)).await;
    host.send_json(&ClientMessage::Host(HostAction::CreateGame {
        game_code: Some(game_code.clone()),
    }))
    .await;
    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.game_code, game_code);
            assert_eq!(state.teams.len(), 1, "Team should still be present");
            assert!(
                state.teams[0].connected,
                "Team should still be marked connected after host reconnect"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Host opens submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Team submits answer (routes still working after reconnect)
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("answer after reconnect".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;

    let host_msg: ServerMessage = host.recv_json().await;
    match host_msg {
        ServerMessage::GameState { state } => {
            let q = &state.questions[0];
            assert_eq!(q.answers.len(), 1);
            assert_eq!(q.answers[0].team_name, "Test Team");
        }
        other => panic!("Expected GameState after submission, got {other:?}"),
    }

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
    let host_msg: ServerMessage = host.recv_json().await;
    match host_msg {
        ServerMessage::GameState { state } => {
            assert_eq!(state.teams[0].score.question_points, 50);
            assert_eq!(state.questions[0].answers[0].score.question_points, 50);
        }
        other => panic!("Expected GameState after score, got {other:?}"),
    }
    // Team also receives the score broadcast
    let _: ServerMessage = team.recv_json().await;
}

#[tokio::test]
async fn cannot_reclaim_game_with_active_host() {
    let server = TestServer::start().await;
    let (host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Try to reclaim the game while the original host is still connected
    let token = create_host_token();
    let mut intruder = TestClient::connect_with_token(&server.ws_url(), Some(&token)).await;
    intruder
        .send_json(&ClientMessage::Host(HostAction::CreateGame {
            game_code: Some(game_code.clone()),
        }))
        .await;

    // Should receive an error
    let response: ServerMessage = intruder.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("already has an active host"),
                "Error should mention active host, got: {message}"
            );
        }
        other => panic!("Expected Error message for game with active host, got {other:?}"),
    }

    // Original host should still be connected (not dropped)
    drop(host);
}
