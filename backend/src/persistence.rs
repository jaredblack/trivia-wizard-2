use crate::infra;
use crate::model::server_message::GameState;
use anyhow::{Result, anyhow};
use aws_config::BehaviorVersion;
use aws_config::meta::region::RegionProviderChain;
use aws_sdk_s3::Client as S3Client;
use aws_sdk_s3::error::SdkError;
use aws_sdk_s3::operation::get_object::GetObjectError;
use log::{info, warn};
use std::env;

pub struct PersistenceClient {
    s3_client: Option<S3Client>,
    bucket_name: String,
}

impl PersistenceClient {
    /// Initialize from environment variables.
    /// If running locally (no S3_BUCKET_NAME), the client will be None
    /// and all operations will be no-ops.
    pub async fn new() -> Self {
        if infra::is_local() {
            info!("Running locally, S3 persistence disabled");
            return PersistenceClient {
                s3_client: None,
                bucket_name: String::new(),
            };
        }

        let bucket_name = env::var("S3_BUCKET_NAME").unwrap_or_else(|_| {
            warn!("S3_BUCKET_NAME not set, persistence disabled");
            String::new()
        });

        if bucket_name.is_empty() {
            return PersistenceClient {
                s3_client: None,
                bucket_name,
            };
        }

        let region_provider = RegionProviderChain::default_provider();
        let config = aws_config::defaults(BehaviorVersion::latest())
            .region(region_provider)
            .load()
            .await;

        let s3_client = S3Client::new(&config);
        info!("S3 persistence enabled with bucket: {bucket_name}");

        PersistenceClient {
            s3_client: Some(s3_client),
            bucket_name,
        }
    }

    /// Build the S3 key for a game state: {user_id}/{game_code}.json
    fn build_key(user_id: &str, game_code: &str) -> String {
        format!("{}/{}.json", user_id, game_code)
    }

    /// Save game state to S3.
    /// If no client (local mode), returns Ok immediately.
    pub async fn save_game_state(
        &self,
        user_id: &str,
        game_code: &str,
        state: &GameState,
    ) -> Result<()> {
        let Some(client) = &self.s3_client else {
            return Ok(());
        };

        let key = Self::build_key(user_id, game_code);
        let body = serde_json::to_string(state)?;

        client
            .put_object()
            .bucket(&self.bucket_name)
            .key(&key)
            .body(body.into_bytes().into())
            .content_type("application/json")
            .send()
            .await?;

        info!("Saved game state to S3: {key}");
        Ok(())
    }

    /// Load game state from S3.
    /// If no client (local mode), returns Ok(None).
    /// Returns Ok(None) if the object doesn't exist (404).
    /// Returns Err on deserialization failure with a user-friendly message.
    pub async fn load_game_state(
        &self,
        user_id: &str,
        game_code: &str,
    ) -> Result<Option<GameState>> {
        let Some(client) = &self.s3_client else {
            return Ok(None);
        };

        let key = Self::build_key(user_id, game_code);

        let result = client
            .get_object()
            .bucket(&self.bucket_name)
            .key(&key)
            .send()
            .await;

        match result {
            Ok(output) => {
                let body = output.body.collect().await?;
                let bytes = body.into_bytes();
                let state: GameState = serde_json::from_slice(&bytes).map_err(|e| {
                    warn!("Failed to deserialize game state from S3: {e}");
                    anyhow!("This saved game is no longer compatible with the current server version")
                })?;
                info!("Loaded game state from S3: {key}");
                Ok(Some(state))
            }
            Err(SdkError::ServiceError(err)) if matches!(err.err(), GetObjectError::NoSuchKey(_)) => {
                info!("No saved game state found in S3: {key}");
                Ok(None)
            }
            Err(e) => {
                warn!("Error loading game state from S3: {e}");
                Err(anyhow!("Failed to load saved game state"))
            }
        }
    }
}
