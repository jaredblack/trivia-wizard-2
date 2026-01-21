# Trivia Wizard - Project Context

A real-time trivia application for live trivia nights. Teams join games via their phones, submit answers, and see scores update in real-time while a host manages questions and scoring.

## Architecture Overview

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│   Host Browser  │◄──────────────────►│                 │
│   (React SPA)   │                    │   Rust Backend  │
└─────────────────┘                    │   (ECS Fargate) │
                                       │                 │
┌─────────────────┐     WebSocket      │   - Game state  │
│  Team Browsers  │◄──────────────────►│   - Scoring     │
│   (React SPA)   │                    │   - Timer       │
└─────────────────┘                    └────────┬────────┘
                                                │
        ┌───────────────────────────────────────┼───────────────┐
        │                                       │               │
        ▼                                       ▼               ▼
┌───────────────┐                      ┌───────────────┐ ┌─────────────┐
│    Cognito    │                      │      S3       │ │   Route53   │
│  (Host Auth)  │                      │ (Game State)  │ │    (DNS)    │
└───────────────┘                      └───────────────┘ └─────────────┘
```

## Project Structure

```
trivia-app/
├── backend/           # Rust WebSocket server
│   ├── src/
│   │   ├── model/     # Game state, types, messages
│   │   └── handler/   # Host and team message handling
│   ├── tests/
│   └── context.md     # Backend-specific context
│
├── frontend/          # React SPA
│   ├── src/
│   │   ├── features/  # Host and team views
│   │   ├── stores/    # Zustand state management
│   │   └── services/  # WebSocket client
│   ├── tests/
│   └── context.md     # Frontend-specific context
│
├── cdk/               # AWS CDK infrastructure
│   ├── lib/           # Stack definitions
│   └── context.md     # Infrastructure-specific context
│
└── docs/              # Documentation
    └── stories.md     # Feature stories/requirements
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Backend | Rust, Tokio, WebSocket (tokio-tungstenite) |
| Frontend | React 19, TypeScript, Vite, Zustand, Tailwind CSS |
| Infrastructure | AWS CDK, ECS Fargate, S3, Cognito, CloudFront, Route53 |
| Authentication | AWS Cognito (hosts only) |

## Core Concepts

### Game Flow

1. **Host starts server** - ECS service scaled from 0 to 1
2. **Host creates game** - Gets a game code, game state initialized
3. **Teams join** - Enter game code + team name, select color and members
4. **Host runs questions** - Start timer, teams submit answers
5. **Host scores answers** - Mark correct/incorrect, adjust bonus points
6. **Repeat** - Navigate to next question, continue until done

### Two User Types

**Host** (authenticated via Cognito):
- Creates and manages games
- Controls timer (start/pause/reset)
- Navigates questions (next/prev)
- Scores answers with bonus points
- Sees all teams' answers and scores
- Can override team scores

**Team** (no authentication):
- Joins game with code + team name
- Submits answers when timer is running
- Sees own answers and score
- Can view score history per question

### Scoring System

Each answer has four score components:
- **Question Points** - Base points for correct answer (0 or question value)
- **Bonus Points** - Host-applied via +/- controls (syncs to matching answers)
- **Speed Bonus** - Placement bonus for early correct answers (server-calculated)
- **Override** - Manual host adjustment to total

### Question Types

- **Standard** - Free-form text answer
- **Multiple Choice** - Select from options (A/B/C/D, Yes/No, True/False, custom)
- **Multi-Answer** - Multiple text inputs (not fully implemented)

### Real-Time Communication

WebSocket-based with two message flows:
- **Host** sends actions (CreateGame, StartTimer, ScoreAnswer, etc.)
- **Team** sends actions (ValidateJoin, JoinGame, SubmitAnswer)
- **Server** broadcasts state updates (GameState to host, TeamGameState to teams)

### Persistence

- Game state saved to S3 on question navigation and host disconnect
- Host can reconnect and restore game from S3
- Teams can reconnect and rejoin (scores preserved)
- Game states auto-expire after 365 days

## Key Features

- **Auto-scoring** - Matching answers automatically get same score
- **Speed bonus** - Configurable placement bonus for fast correct answers
- **Case-insensitive matching** - "ANSWER" matches "answer"
- **Connection resilience** - Auto-reconnect with state restoration
- **On-demand server** - ECS scales to 0 when idle, host starts it

## Domains

- **Frontend:** trivia.jarbla.com
- **WebSocket:** ws.trivia.jarbla.com
- **Health Check:** ws.trivia.jarbla.com/health

## Development

### Local Mode

Set `IS_LOCAL_MAC=true` (backend) and `VITE_LOCAL_MODE=true` (frontend) to:
- Skip Cognito authentication
- Disable S3 persistence
- Use local WebSocket URL

### Running Locally

```bash
# Backend
cd backend
cargo run

# Frontend
cd frontend
npm run dev
```

### Deployment

```bash
# Deploy infrastructure
cd cdk
npx cdk deploy --all

# Frontend auto-deploys via CDK S3BucketDeployment
# Backend container built and pushed by CDK
```

## Detailed Context

See component-specific context files for implementation details:
- [Backend Context](backend/context.md) - Rust server, game logic, WebSocket handling
- [Frontend Context](frontend/context.md) - React components, state management, UI
- [CDK Context](cdk/context.md) - AWS infrastructure, stacks, resources
