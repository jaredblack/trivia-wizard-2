use axum::{Router, routing::get};
use futures_util::{SinkExt, StreamExt};
use log::*;
use model::{
    client_message::{ClientMessage, HostAction, TeamAction},
    game::Game,
    server_message::{HostServerMessage, ServerMessage, TeamServerMessage, send_msg},
};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Mutex, mpsc},
};
use tokio_tungstenite::{
    WebSocketStream, accept_async,
    tungstenite::{Error, Message, Result},
};

use crate::infra::ServiceDiscovery;

mod infra;
mod model;

type Games = Arc<Mutex<HashMap<String, Game>>>;
pub type Tx = mpsc::UnboundedSender<Message>;
pub type Rx = mpsc::UnboundedReceiver<Message>;

async fn accept_connection(peer: SocketAddr, stream: TcpStream, games: Games) {
    if let Err(e) = handle_connection(peer, stream, games).await {
        match e {
            Error::ConnectionClosed | Error::Protocol(_) | Error::Utf8 => (),
            err => error!("Error processing connection: {}", err),
        }
    }
}

async fn handle_connection(peer: SocketAddr, stream: TcpStream, games: Games) -> Result<()> {
    let mut ws_stream = accept_async(stream).await.expect("Failed to accept");

    info!("New WebSocket connection: {}", peer);

    if let Some(msg) = ws_stream.next().await {
        let msg = msg?;
        if let Ok(text) = msg.to_text() {
            info!("Received message: {}", text);
            match serde_json::from_str::<ClientMessage>(text) {
                Ok(client_message) => {
                    info!("Parsed message: {:?}", client_message);
                    match client_message {
                        ClientMessage::Host(action) => {
                            if let HostAction::CreateGame = action {
                                create_game(games, ws_stream).await;
                            } else {
                                error!(
                                    "Expected CreateGame from new Host connection, instead got: {:?}",
                                    action
                                );
                                let error_message = ServerMessage::Error(
                                    "First action must be CreateGame".to_string(),
                                );
                                let msg = serde_json::to_string(&error_message).unwrap();
                                ws_stream.send(Message::text(msg)).await?;
                            }
                        }
                        ClientMessage::Team(action) => {
                            info!("Team message: {:?}", action);
                            if let TeamAction::JoinGame {
                                game_code,
                                team_name,
                            } = action
                            {
                                join_game(games, ws_stream, game_code, team_name).await;
                            } else {
                                error!(
                                    "Expected JoinGame from new Team connection, instead got: {:?}",
                                    action
                                );
                                let error_message = ServerMessage::Error(
                                    "First action must be JoinGame".to_string(),
                                );
                                let msg = serde_json::to_string(&error_message).unwrap();
                                ws_stream.send(Message::text(msg)).await?;
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to parse message: {}", e);
                }
            }
        }
    }

    Ok(())
}

async fn create_game(games: Games, ws_stream: WebSocketStream<TcpStream>) {
    let game_code = "hello".to_string();
    let (tx, rx) = mpsc::unbounded_channel::<Message>();
    let mut games_map = games.lock().await;
    games_map.insert(game_code.clone(), Game::new(game_code.clone(), tx.clone()));
    drop(games_map);
    info!("Game created: {}", game_code);
    let msg = ServerMessage::Host(HostServerMessage::GameCreated {
        game_code: game_code.clone(),
    });
    send_msg(&tx, msg);
    handle_host(ws_stream, games, rx, game_code).await;
}

async fn handle_host(
    ws_stream: WebSocketStream<TcpStream>,
    games: Games,
    mut rx: Rx,
    game_code: String,
) {
    let (mut ws_write, mut ws_read) = ws_stream.split();

    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_write.send(msg).await.is_err() {
                break;
            }
        }
    });

    let games_map = games.clone();

    let read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            if let Ok(text) = msg.to_text() {
                info!("Received message: {}", text);
                let games_map = games_map.lock().await;
                if let Some(game) = games_map.get(&game_code) {
                    match serde_json::from_str::<ClientMessage>(text) {
                        Ok(msg) => {
                            if let ClientMessage::Host(action) = msg {
                                match action {
                                    HostAction::ScoreAnswer { team_name, answer } => {
                                        let msg =
                                            ServerMessage::Host(HostServerMessage::ScoreUpdate {
                                                team_name: team_name.clone(),
                                                score: 1,
                                            });
                                        send_msg(&game.host_tx, msg);
                                    }
                                    HostAction::CreateGame => {
                                        let msg = ServerMessage::Error(
                                            "Game already created".to_string(),
                                        );
                                        send_msg(&game.host_tx, msg);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            error!("Failed to parse message: {}", text);
                            error!("Error: {}", e);
                            let msg = ServerMessage::Error(
                                "Server error: Failed to parse message".to_string(),
                            );
                            send_msg(&game.host_tx, msg);
                        }
                    }
                }
            }
        }
    });

    tokio::select! {
        _ = write_task => {},
        _ = read_task => {},
    }

    /*
    here, call cleanup function, which should
    1. drop the game from the map
    2. start the timer. timer can get a signal which will cause it to cancel the timer. that signal is sent every time a new host connects
    3. timer should shut 'er down. call into infra.rs -- update_task_count or something
     */
}

async fn join_game(
    games: Games,
    ws_stream: WebSocketStream<TcpStream>,
    game_code: String,
    team_name: String,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Message>();
    let mut games_map = games.lock().await;
    if let Some(game) = games_map.get_mut(&game_code) {
        info!("Team {team_name} joined game {game_code}");
        game.add_team(team_name.clone(), tx.clone());
        drop(games_map);
        let msg = ServerMessage::Team(TeamServerMessage::GameJoined {
            game_code: game_code.clone(),
        });
        send_msg(&tx, msg);
        handle_team(ws_stream, games, rx, game_code, team_name).await;
    } else {
        info!("Team {team_name} tried to join game {game_code}, but it doesn't exist");
        let msg = ServerMessage::Error(format!("Game code {game_code} not found"));
        send_msg(&tx, msg);
    }
}

async fn handle_team(
    ws_stream: WebSocketStream<TcpStream>,
    games: Games,
    mut rx: Rx,
    game_code: String,
    team_name: String,
) {
    let (mut ws_write, mut ws_read) = ws_stream.split();

    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_write.send(msg).await.is_err() {
                break;
            }
        }
    });

    let games_map = games.clone();

    let read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            if let Ok(text) = msg.to_text() {
                info!("Received message: {}", text);
                let games_map = games_map.lock().await;
                if let Some(game) = games_map.get(&game_code) {
                    let team_tx = game.teams_tx.get(&team_name).unwrap();
                    match serde_json::from_str::<ClientMessage>(text) {
                        Ok(msg) => {
                            if let ClientMessage::Team(action) = msg {
                                match action {
                                    TeamAction::SubmitAnswer { team_name, answer } => {
                                        let team_msg =
                                            ServerMessage::Team(TeamServerMessage::AnswerSubmitted);
                                        send_msg(team_tx, team_msg);
                                        let host_msg =
                                            ServerMessage::Host(HostServerMessage::NewAnswer {
                                                answer: answer.clone(),
                                                team_name: team_name.clone(),
                                            });
                                        send_msg(&game.host_tx, host_msg);
                                    }
                                    TeamAction::JoinGame { .. } => {
                                        let msg =
                                            ServerMessage::Error("Game already joined".to_string());
                                        send_msg(team_tx, msg);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            error!("Failed to parse message: {}", text);
                            error!("Error: {}", e);
                            let msg = ServerMessage::Error(
                                "Server error: Failed to parse message".to_string(),
                            );
                            send_msg(&game.host_tx, msg);
                        }
                    }
                }
            }
        }
    });
    tokio::select! {
        _ = write_task => {},
        _ = read_task => {},
    }
}

async fn start_ws_server() {
    let addr = "0.0.0.0:9002";
    let listener = TcpListener::bind(&addr).await.expect("Can't listen");
    info!("Listening on: {}", addr);

    let games: Games = Arc::new(Mutex::new(HashMap::new()));

    while let Ok((stream, _)) = listener.accept().await {
        let peer = stream
            .peer_addr()
            .expect("connected streams should have a peer address");
        info!("Peer address: {}", peer);

        tokio::spawn(accept_connection(peer, stream, games.clone()));
    }
}

async fn health_check() -> &'static str {
    "OK"
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();
    info!("Starting Trivia Wizard 2 backend");

    let service_discovery = ServiceDiscovery::new(
        "TriviaWizardServer".to_string(),
        "Z02007853E9RZODID8U1C".to_string(),
        "ws.trivia.jarbla.com.".to_string(),
    )
    .await?;
    // Register the service on startup
    service_discovery.register().await?;

    let ws_server = start_ws_server();

    let health_app = Router::new().route("/health", get(health_check));

    let health_listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();

    tokio::select! {
        _ = ws_server => {},
        _ = axum::serve(health_listener, health_app) => {},
    }

    Ok(())
}
