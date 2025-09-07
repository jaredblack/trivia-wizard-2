use std::env;

use axum::{Router, routing::get};
use log::*;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Result;
use tower_http::cors::{CorsLayer, Any};

use crate::{infra::ServiceDiscovery, server::start_ws_server};

mod infra;
mod model;
mod server;

pub fn is_local() -> bool {
    env::var("ECS_CONTAINER_METADATA_URI_V4").is_err()
}

async fn health_check() -> &'static str {
    "OK"
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();
    info!("Starting Trivia Wizard 2 backend");

    if is_local() {
        info!("Running locally, skipping AWS service setup...")
    } else {
        info!("Running in ECS Fargate. Setting up service discovery...");
        let service_discovery = ServiceDiscovery::new(
            "TriviaWizardServer".to_string(),
            "Z02007853E9RZODID8U1C".to_string(),
            "ws.trivia.jarbla.com.".to_string(),
        )
        .await?;

        service_discovery.register().await?;
    }

    let ws_server = start_ws_server();

    let health_app = Router::new().route("/health", get(health_check)).layer(
        CorsLayer::new()
            .allow_origin(Any)
    );

    let health_listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();

    tokio::select! {
        _ = ws_server => {},
        _ = axum::serve(health_listener, health_app) => {},
    }

    Ok(())
}
