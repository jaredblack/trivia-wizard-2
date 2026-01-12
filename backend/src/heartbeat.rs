use std::time::{Duration, Instant};

pub const PING_INTERVAL: Duration = Duration::from_secs(5);
pub const PONG_TIMEOUT: Duration = Duration::from_secs(10);

pub struct HeartbeatState {
    last_pong: Instant,
}

impl HeartbeatState {
    pub fn new() -> Self {
        Self {
            last_pong: Instant::now(),
        }
    }

    pub fn record_pong(&mut self) {
        self.last_pong = Instant::now();
    }

    pub fn is_alive(&self) -> bool {
        self.last_pong.elapsed() < PONG_TIMEOUT
    }
}

impl Default for HeartbeatState {
    fn default() -> Self {
        Self::new()
    }
}
