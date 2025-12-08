use anyhow::{Result, anyhow};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct AuthResult {
    pub user_id: String,
    pub is_host: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    #[serde(rename = "cognito:groups", default)]
    groups: Vec<String>,
    token_use: String,
    exp: u64,
    iss: String,
    client_id: String,
}

pub trait JwtValidator: Send + Sync {
    fn validate(&self, token: &str) -> Result<AuthResult>;
}

/// Production validator that fetches JWKS from Cognito
pub struct CognitoValidator {
    pub region: String,
    pub user_pool_id: String,
    pub client_id: String,
}

impl CognitoValidator {
    pub fn new(region: String, user_pool_id: String, client_id: String) -> Self {
        Self {
            region,
            user_pool_id,
            client_id,
        }
    }
}

impl JwtValidator for CognitoValidator {
    fn validate(&self, _token: &str) -> Result<AuthResult> {
        // TODO: Implement actual Cognito validation
        // 1. Fetch JWKS from Cognito
        // 2. Decode and verify JWT signature
        // 3. Validate claims (exp, iss, client_id, token_use)
        // 4. Extract sub and groups
        Err(anyhow!("CognitoValidator not yet implemented"))
    }
}

/// Test validator that uses a known RSA key pair
#[cfg(feature = "test-support")]
pub struct TestValidator {
    decoding_key: DecodingKey,
    expected_issuer: String,
    expected_client_id: String,
}

#[cfg(feature = "test-support")]
pub const TEST_ISSUER: &str = "https://cognito-idp.us-east-1.amazonaws.com/test-pool";
#[cfg(feature = "test-support")]
pub const TEST_CLIENT_ID: &str = "test-client-id";

#[cfg(feature = "test-support")]
impl TestValidator {
    pub fn new(public_key_pem: &[u8], issuer: &str, client_id: &str) -> Result<Self> {
        let decoding_key = DecodingKey::from_rsa_pem(public_key_pem)?;
        Ok(Self {
            decoding_key,
            expected_issuer: issuer.to_string(),
            expected_client_id: client_id.to_string(),
        })
    }

    pub fn with_test_keys() -> Self {
        const TEST_PUBLIC_KEY: &str = include_str!("../tests/keys/test_public.pem");
        Self::new(TEST_PUBLIC_KEY.as_bytes(), TEST_ISSUER, TEST_CLIENT_ID)
            .expect("Built-in test keys should be valid")
    }
}

#[cfg(feature = "test-support")]
impl JwtValidator for TestValidator {
    fn validate(&self, token: &str) -> Result<AuthResult> {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.expected_issuer]);
        validation.set_required_spec_claims(&["exp", "sub", "iss"]);

        let token_data = decode::<Claims>(token, &self.decoding_key, &validation)
            .map_err(|e| anyhow!("Invalid token: {}", e))?;

        let claims = token_data.claims;

        if claims.token_use != "access" {
            return Err(anyhow!("Invalid token_use: expected 'access'"));
        }

        if claims.client_id != self.expected_client_id {
            return Err(anyhow!("Invalid client_id"));
        }

        let is_host = claims.groups.contains(&"Trivia-Hosts".to_string());

        Ok(AuthResult {
            user_id: claims.sub,
            is_host,
        })
    }
}

/// Helper to create a validator from environment variables
pub fn create_validator_from_env() -> Arc<dyn JwtValidator> {
    match (
        std::env::var("COGNITO_USER_POOL_ID"),
        std::env::var("COGNITO_CLIENT_ID"),
        std::env::var("AWS_REGION"),
    ) {
        (Ok(user_pool_id), Ok(client_id), Ok(region)) => {
            Arc::new(CognitoValidator::new(region, user_pool_id, client_id))
        }
        _ => {
            panic!("Cognito environment variables (COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, AWS_REGION) must be set");
        }
    }
}
