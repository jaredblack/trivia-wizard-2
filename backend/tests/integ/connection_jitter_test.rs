//! Real-world connection trouble: silent drops, lost replies, abrupt cuts,
//! slow links and flapping.
//!
//! Other reconnection tests close sockets cleanly, so the server learns about
//! the disconnect at once. Here clients go through a `FlakyLink`, which can
//! make a connection go silent without closing it, the way a phone does when
//! it sleeps or changes networks. The server runs with `FAST_HEARTBEAT` so it
//! notices a silent connection in well under a second.

use std::time::Duration;

use crate::{FAST_HEARTBEAT, FlakyLink, TestClient, TestServer};

use backend::model::client_message::{AnswerSubmission, ClientMessage, HostAction, TeamAction};
use backend::model::server_message::{GameState, ServerMessage, TeamGameState};
use backend::model::types::ScoreData;
use backend::server::REPLACED_CLOSE_CODE;

/// Comfortably longer than FAST_HEARTBEAT takes to declare a connection dead.
const PAST_HEARTBEAT_TIMEOUT: Duration = Duration::from_millis(800);

// === Helpers =================================================================

fn team_connected(state: &GameState, team_name: &str) -> Option<bool> {
    state
        .teams
        .iter()
        .find(|t| t.team_name == team_name)
        .map(|t| t.connected)
}

/// Wait until the host's view shows `team_name` with the given connection
/// status.
async fn host_sees_team(host: &mut TestClient, team_name: &str, connected: bool) -> GameState {
    let what = format!("host to see {team_name} connected={connected}");
    match host
        .recv_until(&what, |m| {
            matches!(m, ServerMessage::GameState { state }
                if team_connected(state, team_name) == Some(connected))
        })
        .await
    {
        ServerMessage::GameState { state } => state,
        _ => unreachable!(),
    }
}

/// Wait for the next GameState the host receives.
async fn next_game_state(host: &mut TestClient) -> GameState {
    match host
        .recv_until("GameState", |m| matches!(m, ServerMessage::GameState { .. }))
        .await
    {
        ServerMessage::GameState { state } => state,
        _ => unreachable!(),
    }
}

fn expect_team_state(reply: ServerMessage, context: &str) -> TeamGameState {
    match reply {
        ServerMessage::TeamGameState { state } => state,
        other => panic!("{context}: expected TeamGameState, got {other:?}"),
    }
}

fn expect_game_state(reply: ServerMessage, context: &str) -> GameState {
    match reply {
        ServerMessage::GameState { state } => state,
        other => panic!("{context}: expected GameState, got {other:?}"),
    }
}

/// Host starts the timer; returns once `team` has been told about it. Proves
/// the team's connection is the one the server is sending to.
async fn team_receives_broadcast(host: &mut TestClient, team: &mut TestClient) {
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    team.recv_until("team to hear the timer start", |m| {
        matches!(m, ServerMessage::TeamGameState { state } if state.timer_running)
    })
    .await;
    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;
    team.recv_until("team to hear the timer pause", |m| {
        matches!(m, ServerMessage::TeamGameState { state } if !state.timer_running)
    })
    .await;
}

async fn submit(team: &mut TestClient, team_name: &str, answer: &str) {
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: team_name.to_string(),
        answer: AnswerSubmission::Single(answer.to_string()),
    }))
    .await;
}

/// A game with the host connected directly and one team joined through a
/// flaky link.
struct Setup {
    server: TestServer,
    host: TestClient,
    game_code: String,
    team: TestClient,
    team_link: FlakyLink,
}

const TEAM: &str = "Wanderers";

async fn setup() -> Setup {
    let server = TestServer::start_with_heartbeat(FAST_HEARTBEAT).await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;
    let team_link = FlakyLink::start(server.ws_port).await;
    let mut team = TestClient::connect(&team_link.ws_url()).await;
    team.join_game(&game_code, TEAM).await;
    host_sees_team(&mut host, TEAM, true).await;
    Setup {
        server,
        host,
        game_code,
        team,
        team_link,
    }
}

// === Silent drop: team =======================================================

#[tokio::test]
async fn silent_team_is_marked_disconnected_by_heartbeat() {
    let mut s = setup().await;

    s.team_link.blackhole();

    // No close frame, no FIN: only the heartbeat can notice.
    host_sees_team(&mut s.host, TEAM, false).await;
}

#[tokio::test]
async fn team_can_rejoin_after_server_notices_silent_drop() {
    let mut s = setup().await;
    s.team_link.blackhole();
    host_sees_team(&mut s.host, TEAM, false).await;

    // Same device, new network.
    let (mut team, reply) = TestClient::rejoin_at(&s.server.ws_url(), &s.game_code, TEAM).await;
    expect_team_state(reply, "rejoin after timeout");

    host_sees_team(&mut s.host, TEAM, true).await;
    team_receives_broadcast(&mut s.host, &mut team).await;
}

/// A phone that changes networks reconnects within a second, long before the
/// server's heartbeat gives up on the old connection. The new connection
/// should take over rather than be refused as "Team name already in use".
#[tokio::test]
async fn team_can_rejoin_immediately_while_old_connection_is_silent() {
    let mut s = setup().await;
    s.team_link.blackhole();

    let (mut team, reply) = TestClient::rejoin_at(&s.server.ws_url(), &s.game_code, TEAM).await;
    expect_team_state(reply, "rejoin while old connection is silent");

    team_receives_broadcast(&mut s.host, &mut team).await;
}

/// When the old, silent connection is finally timed out, its cleanup must not
/// disconnect the team's new connection.
#[tokio::test]
async fn silent_old_connection_timing_out_does_not_disconnect_rejoined_team() {
    let mut s = setup().await;
    s.team_link.blackhole();

    let (mut team, reply) = TestClient::rejoin_at(&s.server.ws_url(), &s.game_code, TEAM).await;
    expect_team_state(reply, "rejoin while old connection is silent");

    // Let the old connection's heartbeat expire and its cleanup run.
    tokio::time::sleep(PAST_HEARTBEAT_TIMEOUT).await;

    s.host
        .send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let state = next_game_state(&mut s.host).await;
    assert_eq!(
        team_connected(&state, TEAM),
        Some(true),
        "the old connection's cleanup marked the rejoined team disconnected"
    );
    team.recv_until("rejoined team to hear the timer start", |m| {
        matches!(m, ServerMessage::TeamGameState { state } if state.timer_running)
    })
    .await;
}

/// Taking over is only for reconnects. A different team that types a name
/// already in use in the join wizard is refused rather than kicking the real
/// team off.
#[tokio::test]
async fn fresh_join_with_a_name_in_use_is_refused() {
    let mut s = setup().await;

    let mut other_team = TestClient::connect(&s.server.ws_url()).await;
    other_team
        .send_json(&ClientMessage::Team(TeamAction::ValidateJoin {
            team_name: TEAM.to_string(),
            game_code: s.game_code.clone(),
            rejoin: false,
        }))
        .await;
    let reply: ServerMessage = other_team.recv_json().await;
    assert!(
        matches!(&reply, ServerMessage::Error { message, .. } if message.contains("already in use")),
        "expected the name to be refused, got {reply:?}"
    );

    // The real team is untouched.
    team_receives_broadcast(&mut s.host, &mut s.team).await;
}

/// When the old connection is still reachable (another tab, or a network
/// that recovered), it is told it was replaced, and can no longer act for
/// the team.
#[tokio::test]
async fn replaced_team_connection_is_closed_with_replaced_code() {
    let mut s = setup().await;

    let (mut team, reply) = TestClient::rejoin_at(&s.server.ws_url(), &s.game_code, TEAM).await;
    expect_team_state(reply, "rejoin from a second connection");

    assert_eq!(
        s.team.close_within(Duration::from_secs(1)).await,
        Some(Some(REPLACED_CLOSE_CODE)),
        "old team connection should be closed as replaced"
    );
    let state = next_game_state_after_start(&mut s.host).await;
    assert_eq!(team_connected(&state, TEAM), Some(true));
    team.recv_until("new connection to hear the timer start", |m| {
        matches!(m, ServerMessage::TeamGameState { state } if state.timer_running)
    })
    .await;
}

async fn next_game_state_after_start(host: &mut TestClient) -> GameState {
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    next_game_state(host).await
}

// === Silent drop: host =======================================================

#[tokio::test]
async fn host_can_reclaim_after_server_notices_silent_drop() {
    let server = TestServer::start_with_heartbeat(FAST_HEARTBEAT).await;
    let host_link = FlakyLink::start(server.ws_port).await;
    let (_old_host, game_code) = TestClient::connect_as_host_at(&host_link.ws_url()).await;
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, TEAM).await;

    host_link.blackhole();
    tokio::time::sleep(PAST_HEARTBEAT_TIMEOUT).await;

    let (mut host, reply) = TestClient::reclaim_game_at(&server.ws_url(), &game_code).await;
    let state = expect_game_state(reply, "reclaim after timeout");
    assert_eq!(team_connected(&state, TEAM), Some(true));

    team_receives_broadcast(&mut host, &mut team).await;
}

/// The host's laptop changes networks mid-game and reconnects at once. The
/// new connection should take over rather than be refused with "already has
/// an active host".
#[tokio::test]
async fn host_can_reclaim_immediately_while_old_connection_is_silent() {
    let server = TestServer::start_with_heartbeat(FAST_HEARTBEAT).await;
    let host_link = FlakyLink::start(server.ws_port).await;
    let (_old_host, game_code) = TestClient::connect_as_host_at(&host_link.ws_url()).await;
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, TEAM).await;

    host_link.blackhole();

    let (mut host, reply) = TestClient::reclaim_game_at(&server.ws_url(), &game_code).await;
    expect_game_state(reply, "reclaim while old connection is silent");

    team_receives_broadcast(&mut host, &mut team).await;
}

/// When the old host connection finally times out, its cleanup must not cut
/// off the host's new connection.
#[tokio::test]
async fn silent_old_host_connection_timing_out_does_not_disconnect_new_host() {
    let server = TestServer::start_with_heartbeat(FAST_HEARTBEAT).await;
    let host_link = FlakyLink::start(server.ws_port).await;
    let (_old_host, game_code) = TestClient::connect_as_host_at(&host_link.ws_url()).await;
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, TEAM).await;

    host_link.blackhole();
    let (mut host, reply) = TestClient::reclaim_game_at(&server.ws_url(), &game_code).await;
    expect_game_state(reply, "reclaim while old connection is silent");

    // Let the old connection's heartbeat expire and its cleanup run.
    tokio::time::sleep(PAST_HEARTBEAT_TIMEOUT).await;

    // The new host still gets the team's answers.
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    next_game_state(&mut host).await;
    submit(&mut team, TEAM, "still here").await;
    host.recv_until("new host to receive the team's answer", |m| {
        matches!(m, ServerMessage::GameState { state }
            if state.questions[0].answers.iter().any(|a| a.team_name == TEAM))
    })
    .await;
}

// === Lost replies ============================================================

/// The team's submit reaches the server, but the reply is lost and the
/// connection dies. After rejoining, the team must see its answer as
/// submitted, and a retry must not create a second answer.
#[tokio::test]
async fn submission_whose_reply_was_lost_is_kept_after_rejoin() {
    let mut s = setup().await;
    s.host
        .send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    next_game_state(&mut s.host).await;

    s.team_link.blackhole_downstream();
    submit(&mut s.team, TEAM, "Paris").await;
    s.host
        .recv_until("host to receive the answer", |m| {
            matches!(m, ServerMessage::GameState { state }
                if state.questions[0].answers.iter().any(|a| a.team_name == TEAM))
        })
        .await;
    host_sees_team(&mut s.host, TEAM, false).await;

    let (mut team, reply) = TestClient::rejoin_at(&s.server.ws_url(), &s.game_code, TEAM).await;
    let state = expect_team_state(reply, "rejoin after lost reply");
    assert!(
        state.questions[0].content.is_some(),
        "rejoined team should see its answer as submitted"
    );

    submit(&mut team, TEAM, "Paris").await;
    let retry: ServerMessage = team
        .recv_until("reply to the retried submit", |m| {
            !matches!(m, ServerMessage::TimerTick { .. })
        })
        .await;
    assert!(
        matches!(&retry, ServerMessage::Error { message, .. } if message.contains("already submitted")),
        "retry should be refused, got {retry:?}"
    );
    let host_state = next_game_state(&mut s.host).await;
    let answers = host_state.questions[0]
        .answers
        .iter()
        .filter(|a| a.team_name == TEAM)
        .count();
    assert_eq!(answers, 1, "the retry must not add a second answer");
}

// === Abrupt cut ==============================================================

/// Everything the host does while a team is away is in the state the team
/// gets back when it rejoins.
#[tokio::test]
async fn rejoining_team_sees_what_changed_while_it_was_away() {
    let mut s = setup().await;
    s.host
        .send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    next_game_state(&mut s.host).await;
    submit(&mut s.team, TEAM, "42").await;
    next_game_state(&mut s.host).await;

    s.team_link.sever();
    host_sees_team(&mut s.host, TEAM, false).await;

    s.host
        .send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
            question_number: 1,
            team_name: TEAM.to_string(),
            score: ScoreData {
                question_points: 50,
                bonus_points: 5,
                override_points: 0,
                speed_bonus_points: 0,
            },
        }))
        .await;
    next_game_state(&mut s.host).await;
    s.host
        .send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    next_game_state(&mut s.host).await;

    let (_team, reply) = TestClient::rejoin_at(&s.server.ws_url(), &s.game_code, TEAM).await;
    let state = expect_team_state(reply, "rejoin after cut");
    assert_eq!(state.current_question_number, 2);
    assert_eq!(state.team.score.question_points, 50);
    assert_eq!(state.team.score.bonus_points, 5);
    assert_eq!(state.questions[0].score.question_points, 50);
}

#[tokio::test]
async fn watcher_reconnects_after_cut_and_sees_current_scoreboard() {
    let mut s = setup().await;
    let watcher_link = FlakyLink::start(s.server.ws_port).await;
    let mut watcher = TestClient::connect(&watcher_link.ws_url()).await;
    watcher.watch_game(&s.game_code).await;

    watcher_link.sever();
    assert!(watcher.closed_within(Duration::from_secs(1)).await);

    s.host
        .send_json(&ClientMessage::Host(HostAction::OverrideTeamScore {
            team_name: TEAM.to_string(),
            override_points: 7,
        }))
        .await;
    next_game_state(&mut s.host).await;

    let mut watcher = TestClient::connect(&s.server.ws_url()).await;
    watcher
        .send_json(&ClientMessage::Watcher(
            backend::model::client_message::WatcherAction::WatchGame {
                game_code: s.game_code.clone(),
            },
        ))
        .await;
    match watcher.recv_json().await {
        ServerMessage::ScoreboardData { data } => {
            let team = data.teams.iter().find(|t| t.team_name == TEAM).unwrap();
            assert_eq!(team.score.override_points, 7);
        }
        other => panic!("expected ScoreboardData, got {other:?}"),
    }
}

// === Slow and flapping links =================================================

/// 100ms each way is a bad mobile link, but the heartbeat (300ms timeout in
/// tests) should not mistake it for a dead one.
#[tokio::test]
async fn slow_link_is_not_mistaken_for_a_dead_one() {
    let mut s = setup().await;
    s.team_link.set_latency(Duration::from_millis(100));

    tokio::time::sleep(PAST_HEARTBEAT_TIMEOUT).await;
    team_receives_broadcast(&mut s.host, &mut s.team).await;

    s.host
        .send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let state = next_game_state(&mut s.host).await;
    assert_eq!(team_connected(&state, TEAM), Some(true));
}

/// A team on a bad connection drops and comes back many times while the host
/// keeps playing. Each time it rejoins, its state matches what the host sees.
#[tokio::test]
async fn flapping_team_stays_consistent_with_host() {
    let mut s = setup().await;
    let mut team = Some(s.team);
    let mut link = s.team_link;

    for round in 1..=8 {
        // Alternate an abrupt cut with a silent drop.
        if round % 2 == 0 {
            link.sever();
        } else {
            link.blackhole();
        }
        host_sees_team(&mut s.host, TEAM, false).await;
        drop(team.take());

        // The host keeps playing while the team is gone.
        s.host
            .send_json(&ClientMessage::Host(HostAction::OverrideTeamScore {
                team_name: TEAM.to_string(),
                override_points: round,
            }))
            .await;
        next_game_state(&mut s.host).await;

        link = FlakyLink::start(s.server.ws_port).await;
        let (mut rejoined, reply) = TestClient::rejoin_at(&link.ws_url(), &s.game_code, TEAM).await;
        let state = expect_team_state(reply, &format!("rejoin in round {round}"));
        assert_eq!(state.team.score.override_points, round, "round {round}");

        let host_state = host_sees_team(&mut s.host, TEAM, true).await;
        let host_view = host_state
            .teams
            .iter()
            .find(|t| t.team_name == TEAM)
            .unwrap();
        assert_eq!(host_view.score.override_points, round, "round {round}");
        assert_eq!(host_state.teams.len(), 1, "rejoining must not add a team");

        team_receives_broadcast(&mut s.host, &mut rejoined).await;
        team = Some(rejoined);
    }
}
