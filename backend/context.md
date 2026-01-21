# Backend Context - Trivia Wizard

This document provides context about the backend implementation for future Claude sessions.

## Technology Stack

- **Language:** Rust (Edition 2024)
- **Async Runtime:** Tokio
- **WebSocket:** tokio-tungstenite with rustls
- **Web Framework:** Axum (minimal HTTP wrapper for health checks)
- **Serialization:** Serde + serde_json
- **Authentication:** JWT via jsonwebtoken with AWS Cognito
- **Persistence:** AWS S3
- **Deployment:** Docker + ECS Fargate + Route53

## Project Structure

```
backend/
├── src/
│   ├── main.rs              # Entry point, server initialization
│   ├── lib.rs               # Module exports
│   ├── server.rs            # WebSocket server core, connection handling
│   ├── auth.rs              # JWT validation (Cognito + test support)
│   ├── persistence.rs       # S3-based game state storage
│   ├── game_timer.rs        # Timer management and broadcasting
│   ├── heartbeat.rs         # Connection health monitoring (ping/pong)
│   ├── timer.rs             # Graceful shutdown timer (for ECS scaling)
│   ├── infra.rs             # AWS infrastructure & service discovery
│   ├── model/
│   │   ├── game.rs          # Game state machine (~750 lines, core logic)
│   │   ├── types.rs         # Core entities (Question, Team, Score, etc.)
│   │   ├── client_message.rs # Client→Server messages
│   │   └── server_message.rs # Server→Client messages
│   └── handler/
│       ├── host.rs          # Host-side message handling & game orchestration
│       └── team.rs          # Team-side message handling & answer submission
├── tests/
│   ├── common.rs            # Test harness and utilities
│   └── integ/               # Integration tests
├── Cargo.toml
└── Dockerfile
```

## Core Data Models

### Game (model/game.rs)

The `Game` struct is the central state container:

```rust
pub struct Game {
    pub game_code: String,
    pub host_user_id: String,
    pub host_tx: Option<Tx>,                  // Host WebSocket channel
    pub teams_tx: HashMap<String, Tx>,        // Team WebSocket channels
    pub current_question_number: usize,
    pub timer_running: bool,
    pub timer_seconds_remaining: Option<u32>,
    pub timer_abort_handle: Option<AbortHandle>,
    pub teams: Vec<TeamData>,
    pub questions: Vec<Question>,
    pub game_settings: GameSettings,
}
```

### Question Types (model/types.rs)

```rust
enum QuestionKind {
    Standard,       // Single answer, free-form text
    MultiAnswer,    // Multiple text inputs (not fully implemented)
    MultipleChoice, // A/B/C/D or custom options
}
```

### Multiple Choice Config

```rust
struct McConfig {
    option_type: McOptionType,  // letters, numbers, yesNo, trueFalse, other
    num_options: u32,           // 2-8 options
    custom_options: Vec<String>, // For "other" type
}
```

Option types:
- `letters`: A, B, C, D, E, F, G, H
- `numbers`: 1, 2, 3, 4, 5, 6, 7, 8
- `yesNo`: Yes, No (forces 2 options)
- `trueFalse`: True, False (forces 2 options)
- `other`: Custom option labels

### Scoring (model/types.rs)

```rust
struct ScoreData {
    question_points: i32,    // Base points for correct answer
    bonus_points: i32,       // Host-applied bonus via +/- controls (syncs to matching answers)
    speed_bonus_points: i32, // Placement bonus (1st, 2nd, 3rd place, server-calculated)
    override_points: i32,    // Manual host adjustment to total
}
```

Total score = `question_points + bonus_points + speed_bonus_points + override_points`

## Architecture

### Two-Tier Protocol

1. **Session Setup Phase:** Authentication and game join
2. **Game Loop Phase:** Real-time game state updates

### Dual View Design

- **Hosts** receive full `GameState` (all teams, all answers)
- **Teams** receive filtered `TeamGameState` (own answers only)

### Message Flow

**Host Actions** (client_message.rs):
- CreateGame, StartTimer, PauseTimer, ResetTimer
- NextQuestion, PrevQuestion
- ScoreAnswer, OverrideTeamScore
- UpdateGameSettings, UpdateQuestionSettings, UpdateTypeSpecificSettings

**Team Actions** (client_message.rs):
- ValidateJoin, JoinGame, SubmitAnswer

**Server Messages** (server_message.rs):
- GameState, TeamGameState, TimerTick
- JoinValidated, Error

### State Management

- **In-memory:** `HashMap<game_code, Game>` guarded by Tokio Mutex
- **Persistence:** S3-based, triggered on question navigation and host disconnect
- **Lock pattern:** Parse messages before acquiring lock, send messages after releasing

## Authentication (auth.rs)

- Hosts must authenticate via Cognito JWT in WebSocket URL query string
- Hosts must be in "Trivia-Hosts" Cognito group
- Teams have no authentication (open join)
- Local dev mode (`IS_LOCAL_MAC` env var) skips auth entirely

## Key Flows

### Game Creation (handler/host.rs)

1. Host connects with JWT token
2. Sends `CreateGame` message
3. Server checks if game exists in memory or S3
4. Creates new game or restores existing state
5. Sends `GameState` to host

### Team Join (handler/team.rs)

1. Team connects (no auth)
2. Sends `ValidateJoin` with game_code and team_name
3. If new team: receives `JoinValidated`, then sends `JoinGame` with color/members
4. If reconnecting: receives `TeamGameState` immediately

### Answer Submission (model/game.rs)

1. Team submits answer while `timer_running` is true
2. Answer normalized (trim, lowercase) for matching
3. Auto-scored if matches existing correct answer
4. Speed bonuses recalculated
5. State broadcast to all clients

### Scoring (model/game.rs)

1. Host scores an answer with points + bonus
2. All matching answers (case-insensitive) auto-sync to same score
3. Speed bonuses recalculated based on submission order
4. Team totals updated

### Timer (game_timer.rs)

- 1-second resolution via tokio sleep
- Broadcasts `TimerTick` every second to all clients
- When expired: `timer_running` set to false, submissions close
- Can be paused, reset, or started at any time

## Persistence (persistence.rs)

- S3 key format: `{user_id}/{game_code}.json`
- Saves triggered by:
  - NextQuestion / PrevQuestion
  - Host disconnect (async fire-and-forget)
- Restoration on host reconnection
- Disabled in local mode (no S3_BUCKET_NAME)

## Infrastructure (infra.rs)

**Local Mode:**
- `IS_LOCAL_MAC=true` enables local mode
- Skips Cognito, skips S3, simplified discovery

**Production (ECS Fargate):**
- Detects ECS metadata endpoint
- Queries EC2 for public IP
- Updates Route53 with dynamic IP
- Graceful shutdown timer scales service to 0 on inactivity

## Important Patterns

### Answer Matching
- Case-insensitive, whitespace-trimmed comparison
- When host scores: auto-syncs to ALL matching answers
- When team submits: auto-scores if matches existing correct answer

### Connection Resilience
- Teams can reconnect without re-creating (score preserved)
- Host can reconnect and reclaim game (ownership verified via user_id)
- Game state restored from S3 on host reconnection

### Lock Management
- Minimal lock hold time
- Two-phase pattern: (1) mutate under lock, (2) send messages after release
- Prevents deadlocks and message timeouts

## Testing

- Test harness in `tests/common.rs`
- TestServer spawns in-memory server
- TestClient wraps WebSocket with JSON serialization
- Test JWT generation using embedded test keys
- Integration tests cover all major flows

## Environment Variables

| Variable | Purpose |
|----------|---------|
| IS_LOCAL_MAC | Enables local development mode |
| S3_BUCKET_NAME | S3 bucket for persistence |
| COGNITO_USER_POOL_ID | Cognito user pool for auth |
| COGNITO_CLIENT_ID | Cognito client ID |
| COGNITO_REGION | AWS region for Cognito |
| RUST_LOG | Logging level (default: info) |
