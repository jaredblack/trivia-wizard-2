use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use backend::auth::{self, TEST_CLIENT_ID, TEST_ISSUER};
use backend::heartbeat::HeartbeatConfig;
use backend::model::client_message::{
    AnswerSubmission, ClientMessage, HostAction, TeamAction, WatcherAction,
};
use backend::model::server_message::ServerMessage;
use backend::model::types::{McConfig, McOptionType};
use backend::persistence::PersistenceClient;
use backend::server::start_ws_server;
use backend::timer::ShutdownTimer;
use futures_util::{
    SinkExt, StreamExt,
    stream::SplitSink,
};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::json;
use tokio::{net::TcpListener, sync::mpsc};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};

mod integ;
#[path = "support/flaky_link.rs"]
mod flaky_link;
pub use flaky_link::FlakyLink;

/// Heartbeat for tests that need the server to notice a silent drop
/// quickly: a dead connection is detected in well under a second.
pub const FAST_HEARTBEAT: HeartbeatConfig = HeartbeatConfig {
    ping_interval: Duration::from_millis(50),
    pong_timeout: Duration::from_millis(300),
};

pub struct TestServer {
    pub ws_port: u16,
    _shutdown_tx: mpsc::Sender<()>,
    pub shutdown_rx: mpsc::Receiver<()>,
}

impl TestServer {
    pub async fn start() -> Self {
        Self::start_with_shutdown_duration(Duration::from_secs(2)).await
    }

    pub async fn start_with_shutdown_duration(shutdown_duration: Duration) -> Self {
        Self::start_with(shutdown_duration, HeartbeatConfig::default()).await
    }

    pub async fn start_with_heartbeat(heartbeat: HeartbeatConfig) -> Self {
        Self::start_with(Duration::from_secs(2), heartbeat).await
    }

    async fn start_with(shutdown_duration: Duration, heartbeat: HeartbeatConfig) -> Self {
        // Optional: CI has no .env and sets IS_LOCAL_MAC directly. Tests use
        // TestValidator and no-op persistence, so nothing else in .env is needed.
        dotenvy::dotenv().ok();
        let ws_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_port = ws_listener.local_addr().unwrap().port();

        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

        let timer = ShutdownTimer::new(shutdown_tx.clone(), shutdown_duration);
        let validator = Arc::new(auth::TestValidator::with_test_keys());
        let persistence = Arc::new(PersistenceClient::new().await);
        tokio::spawn(async move {
            start_ws_server(ws_listener, timer, validator, persistence, heartbeat).await;
        });

        // Give the server a moment to start
        tokio::time::sleep(Duration::from_millis(10)).await;

        Self {
            ws_port,
            _shutdown_tx: shutdown_tx,
            shutdown_rx,
        }
    }

    pub fn ws_url(&self) -> String {
        format!("ws://127.0.0.1:{}", self.ws_port)
    }
}

type WsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// What the background reader saw: a text frame, or the end of the stream.
enum Inbound {
    Text(String),
    /// Why the stream ended, and the close frame's code if there was one.
    Closed(String, Option<u16>),
}

/// A WebSocket client for tests.
///
/// A background task keeps reading the socket, the way a browser does, so
/// the client answers server pings even while the test isn't waiting on a
/// message. Text frames are queued for `recv_json` / `recv_until`. Dropping
/// the client stops the reader and closes the socket.
pub struct TestClient {
    write: SplitSink<WsStream, Message>,
    inbox: mpsc::UnboundedReceiver<Inbound>,
    reader: tokio::task::JoinHandle<()>,
}

impl Drop for TestClient {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

const RECV_TIMEOUT: Duration = Duration::from_secs(2);

impl TestClient {
    pub async fn connect(url: &str) -> Self {
        Self::connect_with_token(url, None).await
    }

    pub async fn connect_with_token(url: &str, token: Option<&str>) -> Self {
        let url_with_token = if let Some(token) = token {
            let mut parsed_url = url::Url::parse(url).expect("Invalid URL");
            parsed_url.query_pairs_mut().append_pair("token", token);
            parsed_url.to_string()
        } else {
            url.to_string()
        };
        let (ws_stream, _) = connect_async(url_with_token)
            .await
            .expect("Failed to connect");
        let (write, mut read) = ws_stream.split();
        let (inbox_tx, inbox) = mpsc::unbounded_channel();
        let reader = tokio::spawn(async move {
            loop {
                let inbound = match read.next().await {
                    Some(Ok(Message::Text(text))) => Inbound::Text(text.to_string()),
                    Some(Ok(Message::Close(frame))) => Inbound::Closed(
                        format!("WebSocket closed by server: {frame:?}"),
                        frame.map(|f| u16::from(f.code)),
                    ),
                    None => Inbound::Closed("WebSocket stream closed".into(), None),
                    Some(Ok(_)) => continue, // Ping (auto-ponged), Pong, Binary
                    Some(Err(e)) => Inbound::Closed(format!("WebSocket error: {e}"), None),
                };
                let closed = matches!(inbound, Inbound::Closed(..));
                if inbox_tx.send(inbound).is_err() || closed {
                    break;
                }
            }
        });
        Self {
            write,
            inbox,
            reader,
        }
    }

    pub async fn send_json<T: Serialize>(&mut self, msg: &T) {
        let json = serde_json::to_string(msg).unwrap();
        self.write.send(Message::Text(json.into())).await.unwrap();
    }

    pub async fn send_raw_text(&mut self, text: &str) {
        self.write
            .send(Message::Text(text.to_string().into()))
            .await
            .unwrap();
    }

    pub async fn recv_json<T: DeserializeOwned>(&mut self) -> T {
        match self.recv_within(RECV_TIMEOUT).await {
            Some(text) => serde_json::from_str(&text).unwrap(),
            None => panic!("Timeout waiting for message from server"),
        }
    }

    /// Next text frame within `timeout`, or None if nothing arrived.
    /// Panics if the connection closed.
    pub async fn recv_within(&mut self, timeout: Duration) -> Option<String> {
        match tokio::time::timeout(timeout, self.inbox.recv()).await {
            Ok(Some(Inbound::Text(text))) => Some(text),
            Ok(Some(Inbound::Closed(why, _))) => panic!("{why}"),
            Ok(None) => panic!("WebSocket reader stopped"),
            Err(_) => None,
        }
    }

    /// Skip messages until one matches `pred` and return it. Broadcasts and
    /// timer ticks in between are ignored, so tests can wait on the state
    /// they care about instead of counting messages.
    pub async fn recv_until(
        &mut self,
        what: &str,
        mut pred: impl FnMut(&ServerMessage) -> bool,
    ) -> ServerMessage {
        let deadline = tokio::time::Instant::now() + RECV_TIMEOUT;
        let mut seen = Vec::new();
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            let Some(text) = self.recv_within(remaining).await else {
                panic!("Timed out waiting for {what}; saw {} other messages: {seen:#?}", seen.len());
            };
            let msg: ServerMessage = serde_json::from_str(&text).unwrap();
            if pred(&msg) {
                return msg;
            }
            seen.push(msg);
        }
    }

    /// True if the server closed this connection within `timeout`.
    /// Messages that arrive first are discarded.
    pub async fn closed_within(&mut self, timeout: Duration) -> bool {
        self.close_within(timeout).await.is_some()
    }

    /// If the connection closed within `timeout`, the close frame's code
    /// (None if it closed without one). Messages that arrive first are
    /// discarded.
    pub async fn close_within(&mut self, timeout: Duration) -> Option<Option<u16>> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(remaining, self.inbox.recv()).await {
                Ok(Some(Inbound::Text(_))) => continue,
                Ok(Some(Inbound::Closed(_, code))) => return Some(code),
                Ok(None) => return Some(None),
                Err(_) => return None,
            }
        }
    }

    /// Send CreateGame and return the game code
    /// Note: Requires the client to have connected with a valid host token
    pub async fn create_game(&mut self) -> String {
        self.send_json(&ClientMessage::Host(HostAction::CreateGame {
            game_code: None,
        }))
        .await;

        let response: ServerMessage = self.recv_json().await;
        match response {
            ServerMessage::GameState { state } => state.game_code,
            other => panic!("Expected GameState message, got {other:?}"),
        }
    }

    /// Connect with a host token and create a game
    pub async fn connect_as_host_and_create_game(server: &TestServer) -> (Self, String) {
        Self::connect_as_host_at(&server.ws_url()).await
    }

    /// Like `connect_as_host_and_create_game`, but through any URL (e.g. a
    /// `FlakyLink`).
    pub async fn connect_as_host_at(url: &str) -> (Self, String) {
        let token = create_host_token();
        let mut client = Self::connect_with_token(url, Some(&token)).await;
        let game_code = client.create_game().await;
        (client, game_code)
    }

    /// Open a new host connection that tries to reclaim `game_code`, and
    /// return it with the server's first reply (GameState or Error).
    pub async fn reclaim_game_at(url: &str, game_code: &str) -> (Self, ServerMessage) {
        let token = create_host_token();
        let mut client = Self::connect_with_token(url, Some(&token)).await;
        client
            .send_json(&ClientMessage::Host(HostAction::CreateGame {
                game_code: Some(game_code.to_string()),
            }))
            .await;
        let reply = client.recv_json().await;
        (client, reply)
    }

    /// Open a new team connection that sends ValidateJoin for an existing
    /// team, and return it with the server's reply (TeamGameState on a
    /// successful rejoin, Error otherwise).
    pub async fn rejoin_at(url: &str, game_code: &str, team_name: &str) -> (Self, ServerMessage) {
        let mut client = Self::connect(url).await;
        client
            .send_json(&ClientMessage::Team(TeamAction::ValidateJoin {
                team_name: team_name.to_string(),
                game_code: game_code.to_string(),
                rejoin: true,
            }))
            .await;
        let reply = client.recv_json().await;
        (client, reply)
    }

    /// Send WatchGame and verify success, returning the initial scoreboard data
    pub async fn watch_game(&mut self, game_code: &str) {
        self.send_json(&ClientMessage::Watcher(WatcherAction::WatchGame {
            game_code: game_code.to_string(),
        }))
        .await;

        let response: ServerMessage = self.recv_json().await;
        match response {
            ServerMessage::ScoreboardData { .. } => (),
            other => panic!("Expected ScoreboardData message, got {other:?}"),
        }
    }

    /// Send JoinGame and verify success
    pub async fn join_game(&mut self, game_code: &str, team_name: &str) {
        self.send_json(&ClientMessage::Team(TeamAction::ValidateJoin {
            team_name: team_name.to_string(),
            game_code: game_code.to_string(),
            rejoin: false,
        }))
        .await;
        let response: ServerMessage = self.recv_json().await;
        match response {
            ServerMessage::JoinValidated => (),
            other => panic!("Expected JoinValidated message, got {other:?}"),
        }
        self.send_json(&ClientMessage::Team(TeamAction::JoinGame {
            game_code: game_code.to_string(),
            team_name: team_name.to_string(),
            color_hex: "#DC2626".to_string(),
            color_name: "Red".to_string(),
            team_members: vec!["Test Player".to_string()],
        }))
        .await;

        let response: ServerMessage = self.recv_json().await;
        match response {
            ServerMessage::TeamGameState { state } => {
                assert_eq!(state.game_code, game_code, "Game codes should match");
            }
            other => panic!("Expected TeamGameState message, got {other:?}"),
        }
    }
}

const TEST_PRIVATE_KEY: &str = include_str!("./keys/test_private.pem");

/// Generate a test JWT for authentication tests
pub fn create_test_jwt(user_id: &str, groups: &[&str], expired: bool) -> String {
    let exp = if expired {
        0 // Expired in the past
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600 // 1 hour from now
    };

    let claims = json!({
        "sub": user_id,
        "cognito:groups": groups,
        "token_use": "access",
        "exp": exp,
        "iss": TEST_ISSUER,
        "client_id": TEST_CLIENT_ID,
    });

    let encoding_key = EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY.as_bytes())
        .expect("Test private key should be valid");

    jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &encoding_key)
        .expect("JWT encoding should succeed")
}

/// Generate a valid host token (user in Trivia-Hosts group)
pub fn create_host_token() -> String {
    create_test_jwt("test-host-user", &["Trivia-Hosts"], false)
}

/// Generate a valid token for a user NOT in the hosts group
pub fn create_non_host_token() -> String {
    create_test_jwt("test-regular-user", &[], false)
}

/// Generate an expired token
pub fn create_expired_token() -> String {
    create_test_jwt("test-user", &["Trivia-Hosts"], true)
}

/// Helper function to test answer submission flow:
/// - Team submits answer
/// - Team receives TeamGameState confirmation
/// - Host receives GameState with the answer
/// Note: Requires timer to be running (submissions open)
pub async fn assert_answer_submission_flow(
    team: &mut TestClient,
    host: &mut TestClient,
    team_name: &str,
    answer: &str,
) {
    // Team submits an answer
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: team_name.to_string(),
        answer: AnswerSubmission::Single(answer.to_string()),
    }))
    .await;

    // Team should receive confirmation
    let team_response: ServerMessage = team.recv_json().await;
    match team_response {
        ServerMessage::TeamGameState { .. } => {
            // Success - team got state update
        }
        other => panic!("Expected TeamGameState message, got {other:?}"),
    }

    // Host should receive the updated game state
    let host_response: ServerMessage = host.recv_json().await;
    match host_response {
        ServerMessage::GameState { state } => {
            // Verify the answer was added to the current question
            let question = state
                .questions
                .get(state.current_question_number - 1)
                .expect("Current question number doesn't correspond to a question in the state");
            assert!(
                question.answers.iter().any(|a| {
                    a.team_name == team_name
                        && matches!(&a.content, Some(backend::model::types::AnswerContent::Single { answer_text }) if answer_text == answer)
                }),
                "Answer should appear in question answers"
            );
        }
        other => panic!("Expected GameState message, got {other:?}"),
    }
}

pub fn default_mc_config() -> McConfig {
    McConfig {
        option_type: McOptionType::Letters,
        num_options: 4,
        custom_options: None,
    }
}
