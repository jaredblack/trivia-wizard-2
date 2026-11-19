use std::time::{Duration, Instant};

/// How often the server pings each client and how long it waits for a pong
/// before treating the connection as dead.
///
/// A client whose network silently drops (phone sleeps, wifi → cellular)
/// never sends a close frame, so this timeout is the only way the server
/// learns it is gone. Tests shorten it to exercise those paths quickly.
#[derive(Debug, Clone, Copy)]
pub struct HeartbeatConfig {
    pub ping_interval: Duration,
    pub pong_timeout: Duration,
}

impl Default for HeartbeatConfig {
    fn default() -> Self {
        Self {
            ping_interval: Duration::from_secs(5),
            pong_timeout: Duration::from_secs(10),
        }
    }
}

pub struct HeartbeatState {
    last_pong: Instant,
    pong_timeout: Duration,
}

impl HeartbeatState {
    pub fn new(config: &HeartbeatConfig) -> Self {
        Self {
            last_pong: Instant::now(),
            pong_timeout: config.pong_timeout,
        }
    }

    pub fn record_pong(&mut self) {
        self.last_pong = Instant::now();
    }

    pub fn is_alive(&self) -> bool {
        self.last_pong.elapsed() < self.pong_timeout
    }
}
