use std::time::Duration;

use crate::{TestClient, TestServer};

use backend::model::client_message::{AnswerSubmission, ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::QuestionKind;

/// Helper: set up game, join N teams, drain host join broadcasts.
async fn setup_with_teams(
    server: &TestServer,
    team_names: &[&str],
) -> (TestClient, String, Vec<TestClient>) {
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(server).await;
    let mut teams = Vec::new();
    for name in team_names {
        let mut team = TestClient::connect(&server.ws_url()).await;
        team.join_game(&game_code, name).await;
        let _: ServerMessage = host.recv_json().await;
        teams.push(team);
    }
    (host, game_code, teams)
}

async fn start_timer(host: &mut TestClient, teams: &mut [TestClient]) {
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }
}

async fn submit_single(
    teams: &mut [TestClient],
    host: &mut TestClient,
    team_index: usize,
    team_name: &str,
    answer: &str,
) -> ServerMessage {
    teams[team_index]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: team_name.to_string(),
            answer: AnswerSubmission::Single(answer.to_string()),
        }))
        .await;
    let _: ServerMessage = teams[team_index].recv_json().await;
    host.recv_json().await
}

async fn switch_question_type(
    host: &mut TestClient,
    teams: &mut [TestClient],
    question_type: QuestionKind,
) {
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type,
        speed_bonus_enabled: false,
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    for team in teams.iter_mut() {
        let _: ServerMessage = team.recv_json().await;
    }
}

// === Tests ===

#[tokio::test]
async fn auto_pause_fires_when_last_team_submits() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_with_teams(&server, &["Team1", "Team2"]).await;

    start_timer(&mut host, &mut teams).await;

    // First submission — timer should still be running
    let host_msg = submit_single(&mut teams, &mut host, 0, "Team1", "first").await;
    match host_msg {
        ServerMessage::GameState { state } => {
            assert!(
                state.timer_running,
                "Timer should still run after 1/2 submissions"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Last submission — auto-pause should fire
    let host_msg = submit_single(&mut teams, &mut host, 1, "Team2", "second").await;
    match host_msg {
        ServerMessage::GameState { state } => {
            assert!(
                !state.timer_running,
                "Timer should be paused after all teams submitted"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Confirm no TimerTick arrives in the next 1.5s
    let result = tokio::time::timeout(
        Duration::from_millis(1500),
        host.recv_json::<ServerMessage>(),
    )
    .await;
    assert!(
        result.is_err(),
        "Should not receive any message after auto-pause"
    );
}

#[tokio::test]
async fn no_auto_pause_with_partial_submissions() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) =
        setup_with_teams(&server, &["Team1", "Team2", "Team3"]).await;

    start_timer(&mut host, &mut teams).await;

    let host_msg = submit_single(&mut teams, &mut host, 0, "Team1", "a").await;
    let state = match host_msg {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    };
    assert!(state.timer_running);

    let host_msg = submit_single(&mut teams, &mut host, 1, "Team2", "b").await;
    let state = match host_msg {
        ServerMessage::GameState { state } => state,
        other => panic!("Expected GameState, got {other:?}"),
    };
    assert!(
        state.timer_running,
        "Timer should still run with 2/3 teams submitted"
    );

    // Drain to find a TimerTick (proving timer is still ticking)
    loop {
        let msg: ServerMessage = host.recv_json().await;
        match msg {
            ServerMessage::TimerTick { .. } => break,
            ServerMessage::GameState { .. } => continue,
            other => panic!("Unexpected message: {other:?}"),
        }
    }
}

#[tokio::test]
async fn no_auto_pause_with_zero_teams() {
    let server = TestServer::start().await;
    let (mut host, _code) = TestClient::connect_as_host_and_create_game(&server).await;

    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert!(state.timer_running, "Timer should start running");
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Timer should keep running (auto-pause never fires without a submission)
    let tick: ServerMessage = host.recv_json().await;
    match tick {
        ServerMessage::TimerTick { seconds_remaining } => {
            assert_eq!(seconds_remaining, 29);
        }
        other => panic!("Expected TimerTick, got {other:?}"),
    }
}

#[tokio::test]
async fn auto_pause_works_on_numeric_question() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_with_teams(&server, &["Team1"]).await;

    switch_question_type(&mut host, &mut teams, QuestionKind::Numeric).await;
    start_timer(&mut host, &mut teams).await;

    let host_msg = submit_single(&mut teams, &mut host, 0, "Team1", "42").await;
    match host_msg {
        ServerMessage::GameState { state } => {
            assert!(
                !state.timer_running,
                "Numeric: timer should pause after sole team submits"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn auto_pause_works_on_map_question() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_with_teams(&server, &["Team1"]).await;

    switch_question_type(&mut host, &mut teams, QuestionKind::Map).await;
    start_timer(&mut host, &mut teams).await;

    teams[0]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team1".to_string(),
            answer: AnswerSubmission::Coordinates {
                lat: 40.6892,
                lng: -74.0445,
            },
        }))
        .await;
    let _: ServerMessage = teams[0].recv_json().await;
    let host_msg: ServerMessage = host.recv_json().await;
    match host_msg {
        ServerMessage::GameState { state } => {
            assert!(
                !state.timer_running,
                "Map: timer should pause after sole team submits"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn auto_pause_works_on_multi_answer_question() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_with_teams(&server, &["Team1"]).await;

    switch_question_type(&mut host, &mut teams, QuestionKind::MultiAnswer).await;
    start_timer(&mut host, &mut teams).await;

    teams[0]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team1".to_string(),
            answer: AnswerSubmission::Multi(vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
            ]),
        }))
        .await;
    let _: ServerMessage = teams[0].recv_json().await;
    let host_msg: ServerMessage = host.recv_json().await;
    match host_msg {
        ServerMessage::GameState { state } => {
            assert!(
                !state.timer_running,
                "MultiAnswer: timer should pause after sole team submits"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn submitting_team_sees_paused_state_on_auto_pause() {
    let server = TestServer::start().await;
    let (mut host, _code, mut teams) = setup_with_teams(&server, &["Team1"]).await;

    start_timer(&mut host, &mut teams).await;

    // Single team submits — auto-pause fires
    teams[0]
        .send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
            team_name: "Team1".to_string(),
            answer: AnswerSubmission::Single("answer".to_string()),
        }))
        .await;

    let team_msg: ServerMessage = teams[0].recv_json().await;
    match team_msg {
        ServerMessage::TeamGameState { state } => {
            assert!(
                !state.timer_running,
                "Team should see timer_running: false in their post-submission state"
            );
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }

    let _: ServerMessage = host.recv_json().await; // drain host GameState
}

#[tokio::test]
async fn late_joiner_does_not_resume_auto_paused_timer() {
    let server = TestServer::start().await;
    let (mut host, game_code, mut teams) = setup_with_teams(&server, &["Team1"]).await;

    start_timer(&mut host, &mut teams).await;

    // Single team submits → auto-pause
    let host_msg = submit_single(&mut teams, &mut host, 0, "Team1", "first").await;
    match host_msg {
        ServerMessage::GameState { state } => assert!(!state.timer_running),
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Second team joins late
    let mut team2 = TestClient::connect(&server.ws_url()).await;
    team2.join_game(&game_code, "Team2").await;

    // Host receives GameState reflecting the new team — timer should remain paused
    let host_msg: ServerMessage = host.recv_json().await;
    match host_msg {
        ServerMessage::GameState { state } => {
            assert_eq!(state.teams.len(), 2);
            assert!(
                !state.timer_running,
                "Timer should remain paused after late join — host must manually restart"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Confirm no TimerTick arrives
    let result = tokio::time::timeout(
        Duration::from_millis(1500),
        host.recv_json::<ServerMessage>(),
    )
    .await;
    assert!(result.is_err(), "Timer must not auto-resume");
}
