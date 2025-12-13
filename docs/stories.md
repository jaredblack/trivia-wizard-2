We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

## near future
- Need strongly typed frontend model classes. Lots of gotchas especially for the LLM around the serde rename traits

## Local Development Mode

Goal: Enable easy local frontend/backend development without Cognito auth or the prod WebSocket server.

### Backend Stories

#### Story B1: Skip auth entirely when running locally

In `backend/src/server.rs`, update the WebSocket connection handling:
- Check `infra::is_local()` at the start of connection handling
- If local: skip token validation entirely, auto-create an `AuthResult` with `user_id: "local-dev"` and `is_host: true`
- If not local: keep existing behavior (extract token, validate with CognitoValidator)

This means locally:
- No JWT required from the frontend
- All connections are treated as authenticated hosts
- No need to set `COGNITO_*` env vars

### Frontend Stories

#### Story F1: Add Vite environment configuration

Create environment-based configuration for local vs prod mode:
- Add `.env.development` with `VITE_LOCAL_MODE=true` and `VITE_WS_URL=ws://localhost:8080` (or appropriate port)
- Add `.env.production` with `VITE_LOCAL_MODE=false` and `VITE_WS_URL=wss://ws.trivia.jarbla.com`
- Create a `src/config.ts` module that exports `isLocalMode` and `wsUrl` based on these env vars
- Add `.env*` to `.gitignore` if not already present (keep `.env.development` and `.env.production` tracked since they contain no secrets)

#### Story F2: Add npm scripts for local vs prod dev modes

Update `package.json`:
- `npm run dev` - default local mode (uses `.env.development`)
- `npm run dev:prod` - prod mode for local testing with real auth/server (uses `.env.production`)

Vite supports this via `vite --mode production` or `vite --mode development`.

#### Story F3: Create mock auth bypass for local mode

Create a `src/LocalAuthProvider.tsx` component:
- In local mode, bypass the `Authenticator` component entirely
- Auto-provide a mock user context with a fake user like `{ username: "LocalTestUser", userId: "local-test-123" }`
- Provide a mock `signOut` function that just writes a log message

Update `ProtectedRoute.tsx`:
- Check `isLocalMode` from config
- If local mode, render `LocalAuthProvider` wrapping the outlet
- If prod mode, render the existing `Authenticator` wrapper

#### Story F4: Update WebSocket connection for local mode

Modify `HostLanding.tsx`:
- Import `wsUrl` and `isLocalMode` from config
- In local mode: connect to `ws://localhost:PORT` without any token
- In prod mode: keep existing behavior (fetch auth session, append token)
- Extract WebSocket URL construction into a helper function

#### Story F5: Handle local server not running

Add connection error handling in `HostLanding.tsx`:
- Track WebSocket connection state: `connecting`, `connected`, `disconnected`, `error`
- On WebSocket `onerror` or `onclose` before successful connection in local mode:
  - Display a clear message: "Local server not running"
  - Do not show "Start Server" button (ECS controls don't apply locally)
- In prod mode, keep existing behavior

#### Story F6: Hide ECS server controls in local mode

In `HostLanding.tsx`:
- Hide the "Start Server" / server status UI when in local mode
- The server lifecycle is managed manually by the developer locally
- Only show the game creation flow

#### Story F7: Skip Cognito group check in local mode

In `HostLanding.tsx`:
- The `isHost` check uses Cognito groups to verify authorization
- In local mode, assume the user is always a host (return `true`)
- In prod mode, keep the existing group membership check

## misc
- update verification email
- set an alarm on log::error from my app?


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host