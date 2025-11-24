use crate::server::Tx;
use std::collections::HashMap;

pub struct Game {
    pub game_code: String,
    pub host_tx: Option<Tx>,
    pub teams_tx: HashMap<String, Tx>,
}

impl Game {
    pub fn new(game_code: String, host_tx: Tx) -> Self {
        Self {
            game_code,
            host_tx: Some(host_tx),
            teams_tx: HashMap::new(),
        }
    }

    pub fn set_host_tx(&mut self, host_tx: Tx) {
        self.host_tx = Some(host_tx);
    }

    pub fn clear_host_tx(&mut self) {
        self.host_tx = None;
    }

    pub fn add_team(&mut self, team_name: String, team_tx: Tx) {
        self.teams_tx.insert(team_name, team_tx);
    }
}
