We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

## near future

## Host Authentication with Cognito Access Tokens

### Overview
Implement authentication for host connections using Cognito access tokens. Hosts must provide a valid Cognito access token when establishing a WebSocket connection to create or reclaim games. Team connections remain unauthenticated.

### Design Decisions
- **Token Type**: Cognito Access Token (contains user ID and group membership)
- **Token Delivery**: Query parameter in WebSocket connection URL (`ws://server?token=<access_token>`)
- **Validation Scope**: Only on initial WebSocket connection for hosts
- **Session Duration**: Once authenticated, host remains connected until disconnect (no re-validation)
- **User Storage**: Stub user ID extraction for future use (no persistence yet)

### Backend Tasks (Rust)

#### 1. Add JWT Validation Dependencies
- Add `jsonwebtoken` crate to `Cargo.toml` for JWT verification
- Add `reqwest` with JSON feature (already present) for fetching JWKS
- Add `serde_json` (already present) for parsing JWKS
- No need to cache JWKS.

#### 2. Create Cognito Token Validator Module
- Create new module `src/auth.rs` or `src/cognito.rs`
- Implement function to fetch JWKS from Cognito: `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`
- Implement JWT validation function that:
  - Verifies token signature using JWKS public keys
  - Validates token expiration (`exp` claim)
  - Validates issuer matches Cognito user pool: `https://cognito-idp.{region}.amazonaws.com/{userPoolId}`
  - Validates client ID matches Cognito client ID (`client_id` claim)
  - Validates token use is "access" (`token_use` claim equals `"access"`)
  - Extracts and returns user ID (`sub` claim) for future use
  - Extracts group membership from `cognito:groups` claim
  - Also returns whether principal is in `Trivia-Hosts` group.
- Handle validation errors gracefully with descriptive error types

#### 3. Add Configuration for Cognito Parameters
- Add environment variables for:
  - `AWS_REGION` (e.g., "us-east-1")
  - `COGNITO_USER_POOL_ID` (e.g., "us-east-1_AWbZedeID")
  - `COGNITO_CLIENT_ID` (app client ID)
- Read these from environment in `main.rs` or create a `Config` struct
- Pass config to WebSocket server initialization

#### 4. Modify WebSocket Connection Handling
- Update `handle_connection` in `src/server.rs`:
  - Currently uses `accept_async(stream)` which doesn't expose HTTP request
  - Switch to `accept_hdr_async` to access HTTP headers
  - Parse query parameters from the WebSocket upgrade request URL
  - Extract `token` query parameter if present
  - If token is present, validate it before accepting connection
  - Store validation result (authenticated vs. unauthenticated) for use after first message

#### 5. Implement Host/Team Classification Logic
- After WebSocket connection is accepted, use token presence to classify connection:
  - Token present and valid → connection *can* be a host (still verify first message is CreateGame/ReclaimGame)
  - No token → connection can only be a team
- When first message is received:
  - If message is `Host(CreateGame)` or `Host(ReclaimGame)`:
    - Verify connection was authenticated with valid token
    - If not authenticated, reject with error: "Host actions require authentication"
    - If authenticated, proceed with game creation/reclaim
  - If message is `Team(JoinGame)`:
    - No authentication required, proceed as normal
  - Any other first message:
    - Reject as invalid (existing behavior)

#### 6. Update Error Handling
- Add appropriate errors using anyhow crate
- Send appropriate WebSocket error messages:
  - "Authentication required for host connection" (if CreateGame/ReclaimGame without token)
  - "Invalid or expired authentication token" (if token validation fails)
  - "Authentication failed: [specific reason]" (for debugging, avoid leaking sensitive info)
- Log authentication failures with `warn!` level

#### 7. Add User ID Tracking (Stub)
- In `Game` struct, add optional field: `creator_user_id: Option<String>`
- When creating a game after successful authentication, extract `sub` claim from validated token
- Store user ID in Game struct (not persisted to database yet, just in memory)
- Add TODO comment indicating this will be persisted when database integration is added

#### 8. Testing
- Update WebSocket tests in `tests/websocket_tests.rs`:
  - Add test for host connection without token (should fail)
  - Add test for host connection with invalid token (should fail)
  - Add test for host connection with valid token (should succeed)
  - Add test for team connection without token (should succeed - no auth required)
- Mock JWT validation for tests (use a test token with known values)
- Consider adding integration tests with actual Cognito tokens (optional)

### Frontend Tasks (TypeScript/React)

#### 1. Update WebSocket Connection in HostLanding
- In `HostLanding.tsx`, modify the `startGame` function:
  - Before creating WebSocket connection, fetch access token using `fetchAuthSession()`
  - Extract access token string: `session.tokens?.accessToken?.toString()`
  - Append token as query parameter to WebSocket URL:
    ```typescript
    const token = session.tokens?.accessToken?.toString();
    const wsUrl = `ws://ws.trivia.jarbla.com:9002?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    ```
- Handle case where token is not available (user not authenticated):
  - This shouldn't happen in ProtectedRoute, but add defensive check
  - Display error message to user if token missing

#### 2. Update WebSocket Error Handling
- Add specific handling for authentication errors:
  - Listen for error messages from server related to authentication
  - Display user-friendly error message if authentication fails
  - Possibly prompt user to sign out and sign back in if token is invalid
  - Consider adding token refresh logic if token is expired (optional enhancement)

#### 3. Update Connection Flow for ReclaimGame
- If implementing ReclaimGame functionality in the future:
  - Same token handling as CreateGame
  - Fetch token and append to WebSocket URL before sending ReclaimGame message

#### 4. Handle Token Expiration Edge Cases (Future Enhancement)
- Current design: token only validated on connection, not during session
- If implementing token refresh:
  - Monitor token expiration while game is active
  - Refresh token before expiration using Amplify's automatic refresh
  - Reconnect WebSocket with new token if needed (complex, low priority)

### CDK Tasks (Infrastructure)

#### 1. Add Cognito Configuration to ECS Task
- In `ServerStack.ts`, add environment variables to the ECS task definition:
  - `AWS_REGION`: Pass the stack region
  - `COGNITO_USER_POOL_ID`: Reference from AuthStack
  - `COGNITO_CLIENT_ID`: Reference from AuthStack
- Update `ServerStack` to accept `AuthStack` as a dependency (may already exist)
- Use CDK constructs to pass these values:
  ```typescript
  environment: {
    AWS_REGION: this.region,
    COGNITO_USER_POOL_ID: authStack.userPool.userPoolId,
    COGNITO_CLIENT_ID: authStack.userPoolClient.userPoolClientId,
  }
  ```

#### 2. Centralize Cognito IDs (Addresses Existing TODO)
- Remove hardcoded Cognito IDs from frontend (`frontend/src/aws.ts`)
- Options for centralizing:
  - **Option A**: Use CDK outputs and inject at build time
    - Create a config file generated during deployment
    - Frontend reads from environment variables (Vite `import.meta.env`)
  - **Option B**: Create a config endpoint
    - Add API endpoint that returns Cognito configuration
    - Frontend fetches config on app load
  - **Option C**: Use AWS Amplify configuration
    - Generate `aws-exports.js` from CDK outputs
    - Import in frontend using Amplify conventions
- Recommended: Option A (build-time injection via Vite environment variables)

#### 3. No Additional IAM Changes Required
- AuthStack already has Trivia-Hosts group set up
- No additional permissions needed on backend (it's just validating tokens, not calling Cognito APIs)
- JWKS endpoint is publicly accessible (by design)

### Testing & Validation Tasks

#### 1. End-to-End Testing
- Manual test flow:
  - Sign in as user in Trivia-Hosts group
  - Start game (CreateGame with token)
  - Verify game is created successfully
  - Disconnect and reconnect (ReclaimGame with token)
  - Verify reconnection works
- Negative tests:
  - Try to create game without being authenticated
  - Try to create game with expired/invalid token
  - Verify appropriate error messages are displayed

#### 2. Security Testing
- Verify token is transmitted securely (consider WSS in production)
- Verify tokens are not logged or exposed in error messages
- Test with tampered tokens (modified signature)
- Test with tokens from different Cognito user pools (should fail)

#### 3. Documentation
- Document authentication flow in README or docs
- Document environment variable requirements
- Add comments in code explaining JWT validation logic

## misc
- update verification email
- set an alarm on log::error from my app?


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host