use std::time::Duration;

use backend::server::start_ws_server;
use futures_util::{
    stream::{SplitSink, SplitStream},
    SinkExt, StreamExt,
};
use serde::{de::DeserializeOwned, Serialize};
use tokio::{
    net::TcpListener,
    sync::mpsc,
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

pub struct TestServer {
    pub ws_port: u16,
    _shutdown_tx: mpsc::Sender<()>,
}

impl TestServer {
    pub async fn start() -> Self {
        let ws_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_port = ws_listener.local_addr().unwrap().port();

        let (shutdown_tx, _shutdown_rx) = mpsc::channel(1);

        let shutdown_tx_clone = shutdown_tx.clone();
        tokio::spawn(async move {
            start_ws_server(ws_listener, shutdown_tx_clone).await;
        });

        // Give the server a moment to start
        tokio::time::sleep(Duration::from_millis(10)).await;

        Self {
            ws_port,
            _shutdown_tx: shutdown_tx,
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
        let (ws_stream, _) = connect_async(url).await.expect("Failed to connect");
        let (write, read) = ws_stream.split();
        Self { write, read }
    }

    pub async fn send_json<T: Serialize>(&mut self, msg: &T) {
        let json = serde_json::to_string(msg).unwrap();
        self.write.send(Message::Text(json.into())).await.unwrap();
    }

    pub async fn recv_json<T: DeserializeOwned>(&mut self) -> T {
        let msg = self.read.next().await.unwrap().unwrap();
        serde_json::from_str(msg.to_text().unwrap()).unwrap()
    }

    pub async fn recv_json_timeout<T: DeserializeOwned>(
        &mut self,
        duration: Duration,
    ) -> Option<T> {
        tokio::time::timeout(duration, self.recv_json())
            .await
            .ok()
    }
}
