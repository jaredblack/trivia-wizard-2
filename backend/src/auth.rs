use anyhow::{Result, anyhow};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, jwk::JwkSet};
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

impl CognitoValidator {
    fn jwks_url(&self) -> String {
        format!(
            "https://cognito-idp.{}.amazonaws.com/{}/.well-known/jwks.json",
            self.region, self.user_pool_id
        )
    }

    fn expected_issuer(&self) -> String {
        format!(
            "https://cognito-idp.{}.amazonaws.com/{}",
            self.region, self.user_pool_id
        )
    }

    fn fetch_jwks(&self) -> Result<JwkSet> {
        let response = reqwest::blocking::get(&self.jwks_url())
            .map_err(|e| anyhow!("Failed to fetch JWKS: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "JWKS request failed with status: {}",
                response.status()
            ));
        }

        response
            .json::<JwkSet>()
            .map_err(|e| anyhow!("Failed to parse JWKS: {}", e))
    }

    fn find_decoding_key(&self, jwks: &JwkSet, kid: &str) -> Result<DecodingKey> {
        let jwk = jwks
            .keys
            .iter()
            .find(|k| k.common.key_id.as_deref() == Some(kid))
            .ok_or_else(|| anyhow!("No matching key found for kid: {}", kid))?;

        DecodingKey::from_jwk(jwk).map_err(|e| anyhow!("Failed to create decoding key: {}", e))
    }
}

impl JwtValidator for CognitoValidator {
    fn validate(&self, token: &str) -> Result<AuthResult> {
        // Decode header to get the key ID (kid)
        let header = jsonwebtoken::decode_header(token)
            .map_err(|e| anyhow!("Failed to decode token header: {}", e))?;

        let kid = header
            .kid
            .ok_or_else(|| anyhow!("Token missing kid in header"))?;

        // Fetch JWKS and find the matching key
        let jwks = self.fetch_jwks()?;
        let decoding_key = self.find_decoding_key(&jwks, &kid)?;

        // Set up validation
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.expected_issuer()]);
        validation.set_required_spec_claims(&["exp", "sub", "iss"]);

        // Decode and validate the token
        let token_data = decode::<Claims>(token, &decoding_key, &validation)
            .map_err(|e| anyhow!("Invalid token: {}", e))?;

        let claims = token_data.claims;

        // Validate token_use claim
        if claims.token_use != "access" {
            return Err(anyhow!("Invalid token_use: expected 'access'"));
        }

        // Validate client_id
        if claims.client_id != self.client_id {
            return Err(anyhow!("Invalid client_id"));
        }

        let is_host = claims.groups.contains(&"Trivia-Hosts".to_string());

        Ok(AuthResult {
            user_id: claims.sub,
            is_host,
        })
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
            panic!(
                "Cognito environment variables (COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, AWS_REGION) must be set"
            );
        }
    }
}
