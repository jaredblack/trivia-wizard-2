use std::time::Duration;

use axum::{Router, routing::get};
use log::*;
use tokio::{net::TcpListener, sync::mpsc};
use tokio_tungstenite::tungstenite::Result;
use tower_http::cors::{Any, CorsLayer};

use backend::{
    auth,
    infra::{self, ServiceDiscovery},
    server::start_ws_server,
    timer::ShutdownTimer,
};

const SHUTDOWN_MINS: u64 = 30;

async fn health_check() -> &'static str {
    "OK"
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv()?;
    env_logger::init();
    info!("Starting Trivia Wizard 2 backend");

    if infra::is_local() {
        info!("Running locally, skipping AWS service setup...")
    } else {
        info!("Running in ECS Fargate. Setting up service discovery...");
        let hosted_zone_id =
            std::env::var("ROUTE53_HOSTED_ZONE_ID").expect("ROUTE53_HOSTED_ZONE_ID must be set");
        let service_discovery = ServiceDiscovery::new(
            "TriviaWizardServer".to_string(),
            hosted_zone_id,
            "ws-origin.trivia.jarbla.com.".to_string(),
        )
        .await?;

        service_discovery.register().await?;
    }

    let (shutdown_tx, mut shutdown_rx) = mpsc::channel(1);

    let ws_listener = TcpListener::bind("0.0.0.0:9002").await?;
    let timer = ShutdownTimer::new(shutdown_tx.clone(), Duration::from_secs(SHUTDOWN_MINS * 60));
    let validator = auth::create_validator_from_env();
    let ws_server = start_ws_server(ws_listener, timer, validator);

    let health_app = Router::new()
        .route("/health", get(health_check))
        .layer(CorsLayer::new().allow_origin(Any));

    let health_listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();

    tokio::select! {
        _ = ws_server => {
            info!("WS server task finished");
        },
        _ = axum::serve(health_listener, health_app) => {
            info!("Health check server task finished");
        },
        _ = shutdown_rx.recv() => {
            info!("Shutting down...");
        }
    }

    Ok(())
}
