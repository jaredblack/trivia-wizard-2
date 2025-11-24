# Backend Test Plan

This document outlines the testing strategy for the Trivia Wizard backend server.

## Testing Approach

We will focus on **end-to-end integration tests** that exercise the server's public WebSocket API rather than unit testing internal functions. This approach:

- Tests the system as clients actually use it
- Provides confidence during refactoring
- Catches integration issues between components

## Idiomatic Rust E2E Testing

### Project Structure

```
backend/
├── src/
│   └── ...
└── tests/
    ├── common/
    │   └── mod.rs       # Shared test utilities
    └── websocket_tests.rs
```

Integration tests live in `tests/` directory and are compiled as separate crates with access to the library's public API.

### Test Server Setup

Create a test harness that starts the server on a random available port:

```rust
// tests/common/mod.rs
use tokio::net::TcpListener;
use tokio::sync::mpsc;

pub struct TestServer {
    pub ws_port: u16,
    pub health_port: u16,
    shutdown_tx: mpsc::Sender<()>,
}

impl TestServer {
    pub async fn start() -> Self {
        // Bind to port 0 to get random available ports
        let ws_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let health_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();

        let ws_port = ws_listener.local_addr().unwrap().port();
        let health_port = health_listener.local_addr().unwrap().port();

        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

        // Spawn server with these listeners
        // ... server startup logic

        Self { ws_port, health_port, shutdown_tx }
    }

    pub fn ws_url(&self) -> String {
        format!("ws://127.0.0.1:{}", self.ws_port)
    }
}
```

### WebSocket Test Client

Use `tokio-tungstenite` (already a dependency) for test clients:

```rust
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub struct TestClient {
    write: SplitSink<...>,
    read: SplitStream<...>,
}

impl TestClient {
    pub async fn connect(url: &str) -> Self {
        let (ws_stream, _) = connect_async(url).await.unwrap();
        let (write, read) = ws_stream.split();
        Self { write, read }
    }

    pub async fn send_json<T: Serialize>(&mut self, msg: &T) {
        let json = serde_json::to_string(msg).unwrap();
        self.write.send(Message::Text(json)).await.unwrap();
    }

    pub async fn recv_json<T: DeserializeOwned>(&mut self) -> T {
        let msg = self.read.next().await.unwrap().unwrap();
        serde_json::from_str(msg.to_text().unwrap()).unwrap()
    }

    pub async fn recv_json_timeout<T: DeserializeOwned>(&mut self, duration: Duration) -> Option<T> {
        tokio::time::timeout(duration, self.recv_json()).await.ok()
    }
}
```

### Test Structure

```rust
// tests/websocket_tests.rs
mod common;

use common::{TestServer, TestClient};

#[tokio::test]
async fn test_host_creates_game() {
    let server = TestServer::start().await;
    let mut host = TestClient::connect(&server.ws_url()).await;

    host.send_json(&ClientMessage::Host(HostAction::CreateGame)).await;

    let response: ServerMessage = host.recv_json().await;
    assert!(matches!(
        response,
        ServerMessage::Host(HostServerMessage::GameCreated { .. })
    ));
}
```

### Key Libraries

- `tokio-tungstenite` - WebSocket client (already in use)
- `tokio::test` - Async test runtime
- `serde_json` - Message serialization (already in use)

## Proposed Test Cases

### Connection & Game Setup

- [ ] Host connects and creates a game successfully & Host receives game code after creating game 
- [ ] Team joins existing game with valid code & Team receives confirmation after joining game
- [ ] Team attempts to join non-existent game (error case)
- [ ] Multiple teams can join the same game
- [ ] Multiple hosts can connect and create games, and multiple players can join each of those games in any order

### Message Flow

- [ ] Team submits answer, host receives it
- [ ] Team receives confirmation when answer is submitted
- [ ] (Don't implement yet) Host scores answer, appropriate messages sent 
- [ ] Team submits answer when host is disconnected (error case)

### Host Reconnection

- [ ] Host disconnects and reconnects to existing game
- [ ] Teams remain in game after host reconnects
- [ ] Game state preserved across host reconnection

### Error Handling

- [ ] Invalid JSON message returns error
- [ ] Host sends unexpected message type (e.g., JoinGame)
- [ ] Team sends unexpected message type (e.g., CreateGame)
- [ ] Malformed message handling

### Health Check

- [ ] Health endpoint returns 200 OK
- [ ] Health endpoint includes CORS headers

### Shutdown timer
- [ ] Timer successfully closes server if all hosts disconnect 
    - This will require refactoring SHUTDOWN_MINS to live in an environment variable (or at least be able to be overridden by an environment variable)
- [ ] Timer cancels if a new host connects (a connection that sends at least one ClientMessage::Host)
- [ ] Timer does NOT cancel if a team connects or sends a message
    - Note: this is currently broken! That's ok, we'll let the test fail and then fix it.
