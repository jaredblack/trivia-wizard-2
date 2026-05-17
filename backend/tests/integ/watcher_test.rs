use crate::{TestClient, TestServer};

use backend::model::client_message::{
    AnswerSubmission, ClientMessage, HostAction, TeamAction, WatcherAction,
};
use backend::model::server_message::ServerMessage;
use backend::model::types::{QuestionKind, ScoreData};

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
        answer: AnswerSubmission::Single("42".to_string()),
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

    // Watcher may receive TimerTick messages between timer start and score update.
    // Drain any TimerTick messages to find the ScoreboardData.
    loop {
        let watcher_response: ServerMessage = watcher.recv_json().await;
        match watcher_response {
            ServerMessage::TimerTick { .. } => continue,
            ServerMessage::ScoreboardData { data } => {
                assert_eq!(data.teams.len(), 1, "Should have one team");
                assert_eq!(data.teams[0].team_name, "Test Team");
                assert_eq!(
                    data.teams[0].score.question_points, 50,
                    "Score should be updated"
                );
                break;
            }
            other => panic!("Expected ScoreboardData or TimerTick message, got {other:?}"),
        }
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

/// Drain TimerTicks and other ScoreboardData until we see a scoreboard with the
/// expected team's question_points reaching `expected_points`.
async fn await_scoreboard_with_points(
    watcher: &mut TestClient,
    team_name: &str,
    expected_points: i32,
) {
    loop {
        let msg: ServerMessage = watcher.recv_json().await;
        match msg {
            ServerMessage::TimerTick { .. } => continue,
            ServerMessage::ScoreboardData { data } => {
                let team = data
                    .teams
                    .iter()
                    .find(|t| t.team_name == team_name)
                    .expect("team should be in scoreboard");
                if team.score.question_points == expected_points {
                    return;
                }
                // Keep draining until we see the expected score
            }
            other => panic!("Expected ScoreboardData or TimerTick, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn watcher_receives_update_on_numeric_auto_scoring() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Team1").await;
    let _: ServerMessage = host.recv_json().await;

    // Switch to numeric BEFORE the watcher connects to keep its inbox clean
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Numeric,
        speed_bonus_enabled: false,
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&game_code).await;

    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = watcher.recv_json().await; // start-timer scoreboard

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Team1".to_string(),
        answer: AnswerSubmission::Single("42".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Setting correct answer auto-scores AND broadcasts scoreboard to watchers
    host.send_json(&ClientMessage::Host(HostAction::SetNumericCorrectAnswer {
        question_number: 1,
        correct_answer: Some(42.0),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    await_scoreboard_with_points(&mut watcher, "Team1", 50).await;
}

#[tokio::test]
async fn watcher_receives_update_on_map_auto_scoring() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Team1").await;
    let _: ServerMessage = host.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Map,
        speed_bonus_enabled: false,
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    let mut watcher = TestClient::connect(&server.ws_url()).await;
    watcher.watch_game(&game_code).await;

    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = watcher.recv_json().await;

    let target = (40.6892, -74.0445);
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Team1".to_string(),
        answer: AnswerSubmission::Coordinates {
            lat: target.0,
            lng: target.1,
        },
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::SetMapCorrectLocation {
        question_number: 1,
        correct_location: Some(target),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    await_scoreboard_with_points(&mut watcher, "Team1", 50).await;
}
