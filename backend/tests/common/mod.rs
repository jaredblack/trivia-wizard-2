use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use backend::auth::{self, TEST_CLIENT_ID, TEST_ISSUER};
use backend::model::client_message::{ClientMessage, HostAction, TeamAction};
use backend::model::server_message::{HostServerMessage, ServerMessage, TeamServerMessage};
use backend::server::start_ws_server;
use backend::timer::ShutdownTimer;
use futures_util::{
    SinkExt, StreamExt,
    stream::{SplitSink, SplitStream},
};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::json;
use tokio::{net::TcpListener, sync::mpsc};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};

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
        let ws_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_port = ws_listener.local_addr().unwrap().port();

        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

        let timer = ShutdownTimer::new(shutdown_tx.clone(), shutdown_duration);
        let validator = Arc::new(auth::TestValidator::with_test_keys());
        tokio::spawn(async move {
            start_ws_server(ws_listener, timer, validator).await;
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

pub struct TestClient {
    write: SplitSink<WsStream, Message>,
    read: SplitStream<WsStream>,
}

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
        let (write, read) = ws_stream.split();
        Self { write, read }
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
        let timeout_duration = Duration::from_secs(2);
        match tokio::time::timeout(timeout_duration, self.read.next()).await {
            Ok(Some(Ok(msg))) => serde_json::from_str(msg.to_text().unwrap()).unwrap(),
            Ok(Some(Err(e))) => panic!("WebSocket error: {e}"),
            Ok(None) => panic!("WebSocket stream closed"),
            Err(_) => {
                panic!("Timeout waiting for message from server (waited {timeout_duration:?})")
            }
        }
    }

    /// Send CreateGame and return the game code
    /// Note: Requires the client to have connected with a valid host token
    pub async fn create_game(&mut self) -> String {
        self.send_json(&ClientMessage::Host(HostAction::CreateGame))
            .await;

        let response: ServerMessage = self.recv_json().await;
        match response {
            ServerMessage::Host(HostServerMessage::GameCreated { game_code }) => game_code,
            other => panic!("Expected GameCreated message, got {other:?}"),
        }
    }

    /// Connect with a host token and create a game
    pub async fn connect_as_host_and_create_game(server: &TestServer) -> (Self, String) {
        let token = create_host_token();
        let mut client = Self::connect_with_token(&server.ws_url(), Some(&token)).await;
        let game_code = client.create_game().await;
        (client, game_code)
    }

    /// Send JoinGame and verify success
    pub async fn join_game(&mut self, game_code: &str, team_name: &str) {
        self.send_json(&ClientMessage::Team(TeamAction::JoinGame {
            game_code: game_code.to_string(),
            team_name: team_name.to_string(),
        }))
        .await;

        let response: ServerMessage = self.recv_json().await;
        match response {
            ServerMessage::Team(TeamServerMessage::GameJoined { game_code: code }) => {
                assert_eq!(code, game_code, "Game codes should match");
            }
            other => panic!("Expected GameJoined message, got {other:?}"),
        }
    }
}

const TEST_PRIVATE_KEY: &str = include_str!("../keys/test_private.pem");

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
