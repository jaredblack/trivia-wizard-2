# Frontend Context - Trivia Wizard

This document provides context about the frontend implementation for future Claude sessions.

## Technology Stack

- **Framework:** React 19 with TypeScript
- **Build Tool:** Vite 7
- **State Management:** Zustand
- **Styling:** Tailwind CSS 4
- **Icons:** lucide-react
- **Authentication:** AWS Amplify (Cognito)
- **Cloud SDK:** AWS SDK for ECS management
- **Testing:** Playwright (E2E)
- **Routing:** React Router DOM 7

## Project Structure

```
frontend/
├── src/
│   ├── App.tsx                 # Main routing component
│   ├── main.tsx               # Entry point with AWS Amplify config
│   ├── types.ts               # Comprehensive shared type definitions
│   ├── config.ts              # Environment configuration
│   ├── aws.ts                 # AWS SDK client initialization
│   ├── ProtectedRoute.tsx     # Auth wrapper for host routes
│   ├── LocalAuthProvider.tsx  # Local dev auth fallback
│   ├── LandingPage.tsx        # Public landing page
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   └── Header.tsx
│   │   └── ui/
│   │       ├── Button.tsx           # Polymorphic button (primary/secondary)
│   │       ├── Input.tsx            # Form input with onEnter support
│   │       ├── ColorButton.tsx      # Button with dynamic text contrast
│   │       ├── TimerDisplay.tsx     # Countdown timer display
│   │       ├── ProgressBar.tsx
│   │       ├── Toast.tsx            # Auto-dismiss notifications
│   │       ├── ReconnectionToast.tsx # Connection status indicator
│   │       └── ConfirmationModal.tsx
│   │
│   ├── features/
│   │   ├── host/
│   │   │   ├── HostLanding.tsx      # Server startup + game creation
│   │   │   ├── HostGame.tsx         # Main host game orchestration
│   │   │   └── components/
│   │   │       ├── QuestionControls.tsx       # Header with Q#, type, timer, nav
│   │   │       ├── StandardMainArea.tsx       # Standard question display
│   │   │       ├── MultipleChoiceMainArea.tsx # MC question display
│   │   │       ├── AnswerList.tsx             # Team answers list
│   │   │       ├── AnswerCard.tsx             # Individual answer scoring
│   │   │       ├── Scoreboard.tsx             # Team scores with edit
│   │   │       ├── PerQuestionSettings.tsx    # Footer settings bar
│   │   │       ├── SettingsModal.tsx          # Game-wide settings
│   │   │       ├── McControlsBar.tsx          # MC option configuration
│   │   │       └── AutoSubmitNumericInput.tsx # Number input with auto-save
│   │   │
│   │   └── team/
│   │       ├── TeamFlow.tsx         # Multi-step join orchestration
│   │       └── components/
│   │           ├── TeamGameView.tsx           # Main game UI
│   │           ├── JoinStep.tsx               # Game code + team name
│   │           ├── MembersStep.tsx            # Team member entry
│   │           ├── ColorStep.tsx              # Team color selection
│   │           ├── StandardAnswerInput.tsx    # Text answer submission
│   │           ├── MultipleChoiceAnswerInput.tsx # MC option selection
│   │           ├── ScoreLogDrawer.tsx         # Historical scores
│   │           └── TeamHeader.tsx
│   │
│   ├── hooks/
│   │   └── useWebSocket.ts     # WebSocket integration hook
│   │
│   ├── stores/
│   │   ├── useHostStore.ts     # Zustand host state
│   │   └── useTeamStore.ts     # Zustand team state
│   │
│   ├── services/
│   │   └── websocket.ts        # WebSocket service singleton
│   │
│   └── utils/
│       ├── colors.ts           # Team color palette (16 colors)
│       └── rejoinStorage.ts    # localStorage persistence for reconnect
│
├── tests/                      # Playwright E2E tests
│   ├── host.spec.ts
│   ├── team-join.spec.ts
│   ├── game-flow.spec.ts
│   ├── scoring.spec.ts
│   ├── question-types.spec.ts
│   ├── timer.spec.ts
│   ├── settings.spec.ts
│   ├── speed-bonus.spec.ts
│   └── helpers.ts
│
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── playwright.config.ts
```

## Routes

```
/                    → LandingPage (public)
/home                → LandingPage (alias)
/join                → TeamFlow (public, team join + game)
/watch               → Placeholder (coming soon)
/host                → ProtectedRoute wrapper
  /host/             → HostLanding (server startup)
  /host/game         → HostGame (main game view)
```

## State Management

### Zustand Stores

**useHostStore** - Host game state:
- `gameCode`, `currentQuestionNumber`, `timerRunning`, `timerSecondsRemaining`
- `gameSettings`, `questions[]`, `teams[]`
- Actions: `setGameState()`, `setTimerSecondsRemaining()`, `clearGame()`

**useTeamStore** - Team join flow + game state:
- Join flow: `step` ("join" | "members" | "color" | "game")
- Inputs: `gameCode`, `teamName`, `teamMembers[]`, `selectedColor`
- UI state: `isValidating`, `error`
- Server data: `teamGameState`
- Actions: setters for each field, `addMember`, `removeMember`

### Data Flow

1. WebSocket receives server message
2. `useWebSocket()` hook routes to appropriate store action
3. Components subscribe to store via hooks
4. State updates trigger re-renders
5. User interactions create new WebSocket messages

## WebSocket Communication

### WebSocketService (services/websocket.ts)

Singleton that manages connection lifecycle:
- States: disconnected → connecting → connected → reconnecting → error
- Auto-reconnection with exponential backoff (max 5 attempts)
- Token auth: AWS Amplify access token in URL query string

### Server Messages

```typescript
type ServerMessage =
  | { type: "gameState", state: GameState }
  | { type: "teamGameState", state: TeamGameState }
  | { type: "timerTick", secondsRemaining: number }
  | { type: "joinValidated" }
  | { type: "error", message: string, state?: GameState }
```

### Client Messages

```typescript
type ClientMessage =
  | { host: HostAction }
  | { team: TeamAction }
```

**Host Actions:**
- `createGame` - Start/restore a game
- `startTimer` / `pauseTimer` / `resetTimer`
- `nextQuestion` / `prevQuestion`
- `scoreAnswer` - Score a team's answer
- `overrideTeamScore` - Manual score adjustment
- `updateGameSettings` - Game-wide defaults
- `updateQuestionSettings` - Per-question settings
- `updateTypeSpecificSettings` - MC configuration

**Team Actions:**
- `validateJoin` - Check game code + team name availability
- `joinGame` - Complete join with color and members
- `submitAnswer` - Submit answer to current question

## Host vs Team Views

### Host View (/host/game)

**Purpose:** Question management, answer scoring, team monitoring

**Layout:**
- Header: Question number, type selector, timer controls, navigation
- Main: Answer cards (left), Scoreboard (right sidebar)
- Footer: Per-question settings (points, bonus, timer, speed bonus)

**Key Features:**
- Timer control (play/pause/reset)
- Question navigation (prev/next)
- Question type switching (standard/multiAnswer/MC)
- Answer scoring with bonus adjustment
- Manual score override
- Game-wide settings modal

### Team View (/join)

**Purpose:** Join game, submit answers, track score

**Join Flow (4 steps):**
1. JoinStep: Game code + team name (server validation)
2. MembersStep: Add team member names
3. ColorStep: Select from 16-color palette
4. TeamGameView: Submit answers, view scores

**During Game:**
- Question number and timer display
- Answer input (text or MC grid)
- Submitted answer confirmation
- Score display and score log drawer

## Type System (types.ts)

### Question Types

```typescript
type QuestionKind = "standard" | "multiAnswer" | "multipleChoice"

type QuestionConfig =
  | { type: "standard" }
  | { type: "multiAnswer" }
  | { type: "multipleChoice", config: McConfig }

type McConfig = {
  optionType: "letters" | "numbers" | "yesNo" | "trueFalse" | "other"
  numOptions: number  // 2-8
  customOptions?: string[]
}
```

### Answer Types

```typescript
type AnswerContent =
  | { type: "standard", answerText: string }
  | { type: "multiAnswer", answers: string[] }
  | { type: "multipleChoice", selected: string }
```

### Score Breakdown

```typescript
type ScoreData = {
  questionPoints: number    // Base points (0 or question value)
  bonusPoints: number       // Host-applied bonus via +/- controls (syncs to matching answers)
  speedBonusPoints: number  // Placement bonus (server-calculated)
  overridePoints: number    // Manual host adjustment to total
}
// Total = questionPoints + bonusPoints + speedBonusPoints + overridePoints
```

## Key Patterns

### Rejoin/Persistence (utils/rejoinStorage.ts)

- Stores join data in localStorage with 24-hour expiration
- Host saves gameCode on game creation
- Team saves gameCode + teamName when joining
- On page refresh, auto-attempts rejoin
- Visibility API: disconnects when tab hidden, reconnects when visible

### Score Editing (Scoreboard)

- Click score cell to enter edit mode
- Supports expressions: "100", "50 + 25", "100 - 10"
- Calculates override as: `desired - question - bonus - speed`
- Score breakdown shown on hover

### Timer Sync

- Server broadcasts `timerTick` every second (authoritative)
- Client displays server's `secondsRemaining`
- No client-side countdown (prevents desync)
- Auto-submit on timer expiration if draft answer exists

### Connection Resilience

- Auto-reconnection with backoff (max 5 attempts)
- Host re-sends `createGame` on reconnect
- Team re-sends `validateJoin` on reconnect
- ReconnectionToast shows status with cancel button

## UI Components

### Button

Polymorphic component supporting:
- Variants: primary (blue), secondary (white)
- Can render as `<button>`, `<Link>`, or `<a>`
- Props: `onClick`, `to`, `href`, `disabled`

### ColorButton

Button with dynamic text color based on background luminance:
- Uses WCAG relative luminance formula
- Ensures readability on any team color

### AutoSubmitNumericInput

Number input that auto-submits on:
- Arrow button click (+/-)
- Blur
- Enter key press

Used for points, bonus, timer, MC option count.

### Toast / ReconnectionToast

- Toast: Auto-dismiss after 4 seconds
- ReconnectionToast: Shows spinner during reconnect, cancel button

## Styling

- **Tailwind CSS only** - No CSS modules or CSS-in-JS
- Team colors applied via inline `style={{ backgroundColor }}`
- Icons from lucide-react with consistent sizing (w-4 h-4)
- Responsive design with `md:` breakpoint prefix

## Environment Variables

| Variable | Purpose |
|----------|---------|
| VITE_LOCAL_MODE | Enable local dev auth mock |
| VITE_WS_URL | WebSocket server URL |
| VITE_HEALTH_URL | Health check endpoint |

## Development

```bash
npm run dev        # Vite dev server with HMR
npm run build      # TypeScript + Vite production build
npm run lint       # ESLint check
npm run preview    # Preview built output
```

## Testing

Playwright E2E tests cover:
- Host functionality (timer, navigation, settings)
- Team join flow validation
- Full game workflow
- Answer scoring mechanics
- Question type rendering
- Timer sync and auto-submit
- Speed bonus calculation
