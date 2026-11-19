//! A TCP proxy that sits between a test client and the server and can
//! misbehave on command, to reproduce real-world network trouble.
//!
//! - `blackhole()` keeps both sockets open but stops delivering bytes. Neither
//!   side sees a close: this is a phone that slept or switched from wifi to
//!   cellular. Only the server's heartbeat can notice.
//! - `blackhole_downstream()` delivers client → server but drops
//!   server → client, so the server acts on a message whose reply never
//!   arrives.
//! - `sever()` drops every connection through the link at once, without a
//!   WebSocket close frame (TCP FIN to both sides).
//! - `set_latency()` delays each chunk in both directions, keeping order.
//! - `restore()` goes back to delivering normally.
//!
//! Each link listens on its own port and applies its mode to every
//! connection through it. To model "the same device on a new network",
//! connect the new client directly to the server or through a fresh link.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

struct Control {
    deliver_up: AtomicBool,
    deliver_down: AtomicBool,
    latency_ms: AtomicU64,
}

pub struct FlakyLink {
    port: u16,
    control: Arc<Control>,
    /// Bumped by `sever()`; every pump exits when it changes. Dropping the
    /// link drops the sender, which also stops every pump.
    sever_tx: watch::Sender<u64>,
    accept_task: tokio::task::JoinHandle<()>,
}

impl Drop for FlakyLink {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

impl FlakyLink {
    /// Start a link that forwards to the server at `upstream_port`.
    pub async fn start(upstream_port: u16) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let control = Arc::new(Control {
            deliver_up: AtomicBool::new(true),
            deliver_down: AtomicBool::new(true),
            latency_ms: AtomicU64::new(0),
        });
        let (sever_tx, sever_rx) = watch::channel(0u64);

        let accept_control = control.clone();
        let accept_task = tokio::spawn(async move {
            while let Ok((client, _)) = listener.accept().await {
                let Ok(server) = TcpStream::connect(("127.0.0.1", upstream_port)).await else {
                    continue;
                };
                let _ = client.set_nodelay(true);
                let _ = server.set_nodelay(true);
                let (client_read, client_write) = client.into_split();
                let (server_read, server_write) = server.into_split();
                tokio::spawn(pump(
                    client_read,
                    server_write,
                    accept_control.clone(),
                    Direction::Up,
                    sever_rx.clone(),
                ));
                tokio::spawn(pump(
                    server_read,
                    client_write,
                    accept_control.clone(),
                    Direction::Down,
                    sever_rx.clone(),
                ));
            }
        });

        Self {
            port,
            control,
            sever_tx,
            accept_task,
        }
    }

    pub fn ws_url(&self) -> String {
        format!("ws://127.0.0.1:{}", self.port)
    }

    pub fn blackhole(&self) {
        self.control.deliver_up.store(false, Ordering::SeqCst);
        self.control.deliver_down.store(false, Ordering::SeqCst);
    }

    pub fn blackhole_downstream(&self) {
        self.control.deliver_down.store(false, Ordering::SeqCst);
    }

    pub fn restore(&self) {
        self.control.deliver_up.store(true, Ordering::SeqCst);
        self.control.deliver_down.store(true, Ordering::SeqCst);
    }

    pub fn set_latency(&self, latency: Duration) {
        self.control
            .latency_ms
            .store(latency.as_millis() as u64, Ordering::SeqCst);
    }

    pub fn sever(&self) {
        self.sever_tx.send_modify(|generation| *generation += 1);
    }
}

#[derive(Clone, Copy)]
enum Direction {
    Up,
    Down,
}

impl Control {
    fn delivers(&self, direction: Direction) -> bool {
        match direction {
            Direction::Up => self.deliver_up.load(Ordering::SeqCst),
            Direction::Down => self.deliver_down.load(Ordering::SeqCst),
        }
    }
}

async fn pump(
    mut from: OwnedReadHalf,
    mut to: OwnedWriteHalf,
    control: Arc<Control>,
    direction: Direction,
    mut sever_rx: watch::Receiver<u64>,
) {
    let mut buf = vec![0u8; 16 * 1024];
    loop {
        tokio::select! {
            _ = sever_rx.changed() => return, // drops both halves: FIN both ways
            read = from.read(&mut buf) => {
                let n = match read {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                let latency = control.latency_ms.load(Ordering::SeqCst);
                if latency > 0 {
                    tokio::time::sleep(Duration::from_millis(latency)).await;
                }
                if control.delivers(direction) && to.write_all(&buf[..n]).await.is_err() {
                    break;
                }
            }
        }
    }

    // The source closed. If this direction is delivering, pass the close on.
    // If it's blackholed, the far side must not find out: hold the write
    // half open (dropping it would send FIN) until the link is severed or
    // dropped.
    if control.delivers(direction) {
        let _ = to.shutdown().await;
    } else {
        let _ = sever_rx.changed().await;
    }
}
