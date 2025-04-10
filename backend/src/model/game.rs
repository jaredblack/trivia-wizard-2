use std::collections::HashMap;
use crate::Tx;


pub struct Game {
    pub game_code: String,
    pub host_tx: Tx,
    pub teams_tx: HashMap<String, Tx>,
}

impl Game {
    pub fn new(game_code: String, host_tx: Tx) -> Self {
        Self { game_code, host_tx, teams_tx: HashMap::new() }
    }

    pub fn add_team(&mut self, team_name: String, team_tx: Tx) {
        self.teams_tx.insert(team_name, team_tx);
    }
}