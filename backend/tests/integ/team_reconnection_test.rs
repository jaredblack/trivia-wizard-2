use crate::{TestClient, TestServer};

use backend::model::client_message::{AnswerSubmission, ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::{AnswerContent, QuestionKind, ScoreData};

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
                answer: AnswerSubmission::Single("Answer 42".to_string()),
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
        speed_bonus_points: 0,
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

    // Team A reconnects by sending JoinGame message again, this time lowercase
    let mut team_a_reconnected = TestClient::connect(&server.ws_url()).await;
    team_a_reconnected
        .send_json(&ClientMessage::Team(TeamAction::ValidateJoin {
            team_name: "Test Team A".to_lowercase(),
            game_code: game_code.clone(),
        }))
        .await;
    let response: ServerMessage = team_a_reconnected.recv_json().await;

    match response {
        ServerMessage::TeamGameState { state } => {
            assert_eq!(state.game_code, game_code, "Game codes should match");
        }
        other => panic!("Expected TeamGameState message, got {other:?}"),
    }

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

/// Helper: disconnect a team, drop, and verify host sees disconnect broadcast
async fn disconnect_team(team: TestClient, host: &mut TestClient) {
    drop(team);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let host_update: ServerMessage = host.recv_json().await;
    match host_update {
        ServerMessage::GameState { state } => {
            assert!(
                state.teams.iter().any(|t| !t.connected),
                "At least one team should be disconnected"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

/// Helper: reconnect a team and return the new client + verify host gets update
async fn reconnect_team(
    server: &TestServer,
    host: &mut TestClient,
    game_code: &str,
    team_name: &str,
) -> (TestClient, ServerMessage) {
    let mut client = TestClient::connect(&server.ws_url()).await;
    client
        .send_json(&ClientMessage::Team(TeamAction::ValidateJoin {
            team_name: team_name.to_string(),
            game_code: game_code.to_string(),
        }))
        .await;
    let team_msg: ServerMessage = client.recv_json().await;
    let _: ServerMessage = host.recv_json().await; // host sees reconnect
    (client, team_msg)
}

#[tokio::test]
async fn team_reconnects_after_numeric_auto_scored_answer() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Team1").await;
    let _: ServerMessage = host.recv_json().await;

    // Switch to numeric
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

    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Team1".to_string(),
        answer: AnswerSubmission::Single("42".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::SetNumericCorrectAnswer {
        question_number: 1,
        correct_answer: Some(42.0),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Disconnect and reconnect
    disconnect_team(team, &mut host).await;
    let (_reconnected, team_msg) = reconnect_team(&server, &mut host, &game_code, "Team1").await;

    match team_msg {
        ServerMessage::TeamGameState { state } => {
            assert_eq!(state.team.score.question_points, 50);
            assert_eq!(state.questions[0].score.question_points, 50);
            match &state.questions[0].content {
                Some(AnswerContent::Single { answer_text }) => assert_eq!(answer_text, "42"),
                other => panic!("Expected Single content, got {other:?}"),
            }
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}

#[tokio::test]
async fn team_reconnects_after_map_auto_scored_answer() {
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

    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

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

    disconnect_team(team, &mut host).await;
    let (_reconnected, team_msg) = reconnect_team(&server, &mut host, &game_code, "Team1").await;

    match team_msg {
        ServerMessage::TeamGameState { state } => {
            assert_eq!(state.team.score.question_points, 50);
            assert_eq!(state.questions[0].score.question_points, 50);
            match &state.questions[0].content {
                Some(AnswerContent::Coordinates { lat, lng }) => {
                    assert!((lat - target.0).abs() < 1e-9);
                    assert!((lng - target.1).abs() < 1e-9);
                }
                other => panic!("Expected Coordinates content, got {other:?}"),
            }
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}

#[tokio::test]
async fn team_reconnects_after_multi_answer_with_toggled_correctness() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Team1").await;
    let _: ServerMessage = host.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 60,
        bonus_increment: 5,
        question_type: QuestionKind::MultiAnswer,
        speed_bonus_enabled: false,
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Team1".to_string(),
        answer: AnswerSubmission::Multi(vec![
            "alpha".to_string(),
            "beta".to_string(),
            "gamma".to_string(),
        ]),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Toggle "alpha" and "beta" correct
    for idx in [0usize, 1] {
        host.send_json(&ClientMessage::Host(
            HostAction::ToggleMultiAnswerCorrectness {
                question_number: 1,
                team_name: "Team1".to_string(),
                sub_answer_index: idx,
            },
        ))
        .await;
        let _: ServerMessage = host.recv_json().await;
        let _: ServerMessage = team.recv_json().await;
    }

    disconnect_team(team, &mut host).await;
    let (_reconnected, team_msg) = reconnect_team(&server, &mut host, &game_code, "Team1").await;

    match team_msg {
        ServerMessage::TeamGameState { state } => {
            match &state.questions[0].content {
                Some(AnswerContent::Multi { answers, correct }) => {
                    assert_eq!(
                        answers,
                        &vec!["alpha".to_string(), "beta".to_string(), "gamma".to_string()]
                    );
                    assert_eq!(correct, &vec![true, true, false]);
                }
                other => panic!("Expected Multi content, got {other:?}"),
            }
            assert!(
                state.questions[0].score.question_points > 0,
                "Expected non-zero score after toggles"
            );
            assert_eq!(
                state.team.score.question_points, state.questions[0].score.question_points,
                "Cumulative score should match the single answer's score"
            );
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}

#[tokio::test]
async fn team_reconnects_mid_game_with_multiple_scored_questions() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Team1").await;
    let _: ServerMessage = host.recv_json().await;

    // Q1: Standard, submit + score
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Team1".to_string(),
        answer: AnswerSubmission::Single("q1 answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Team1".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Q2: Standard, no submission (skipped)
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Q3: Standard, submit + score
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Team1".to_string(),
        answer: AnswerSubmission::Single("q3 answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 3,
        team_name: "Team1".to_string(),
        score: ScoreData {
            question_points: 75,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Navigate back to Q2, then disconnect & reconnect
    host.send_json(&ClientMessage::Host(HostAction::PrevQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    disconnect_team(team, &mut host).await;
    let (_reconnected, team_msg) = reconnect_team(&server, &mut host, &game_code, "Team1").await;

    match team_msg {
        ServerMessage::TeamGameState { state } => {
            // Currently on Q2
            assert_eq!(state.current_question_number, 2);
            // 3 questions: Q1 scored 50, Q2 empty, Q3 scored 75
            assert_eq!(state.questions.len(), 3);
            assert_eq!(state.questions[0].score.question_points, 50);
            assert_eq!(state.questions[1].score.question_points, 0);
            assert!(state.questions[1].content.is_none());
            assert_eq!(state.questions[2].score.question_points, 75);
            // Cumulative team score
            assert_eq!(state.team.score.question_points, 125);
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}
