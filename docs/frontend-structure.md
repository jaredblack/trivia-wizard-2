# Trivia Wizard Frontend Structure

This document outlines the recommended React project structure for Trivia Wizard, leveraging the existing stack (Vite, React 19, TailwindCSS 4, React Router 7, AWS Amplify) and modern React patterns.

## Technology Stack

| Concern | Technology | Notes |
|---------|------------|-------|
| Build | Vite | Already configured |
| UI | React 19 | Already configured |
| Styling | TailwindCSS 4 | Already configured; sufficient for dynamic team colors via CSS variables |
| Routing | React Router 7 | Already configured |
| Auth | AWS Amplify | Already configured for Cognito |
| State Management | **Zustand** | Recommended addition - lightweight, works well with WebSockets |
| Icons | Lucide React | Already installed |

### Why Zustand for State Management

Given the WebSocket-driven nature of the app, Zustand is a good fit because:
- Minimal boilerplate compared to Redux
- Works seamlessly with WebSocket event handlers (can update store from outside React)
- Supports middleware for persistence and devtools
- Handles the separate host/team state domains cleanly with slices

## Directory Structure

```
src/
├── main.tsx                    # App entry point
├── App.tsx                     # Router configuration
├── index.css                   # Global styles + Tailwind imports
│
├── components/                 # Shared UI components
│   ├── ui/                     # Primitive components
│   │   ├── Button.tsx          # Primary/secondary/team-colored variants
│   │   ├── Input.tsx           # Text input with consistent styling
│   │   ├── Modal.tsx           # Reusable modal overlay
│   │   ├── Timer.tsx           # Countdown timer display
│   │   ├── TeamBadge.tsx       # Team name with color dot
│   │   └── ColorPicker.tsx     # Team color selection grid
│   │
│   └── layout/                 # Layout components
│       ├── MobileLayout.tsx    # Team view wrapper (back button, header)
│       └── DesktopLayout.tsx   # Host view wrapper (header, nav)
│
├── features/                   # Feature-based modules
│   ├── auth/                   # Authentication
│   │   ├── ProtectedRoute.tsx  # Route guard (existing)
│   │   └── LocalAuthProvider.tsx # Dev mode auth (existing)
│   │
│   ├── landing/                # Public landing page
│   │   └── LandingPage.tsx     # Join Game / Host Login / Watch Scoreboard
│   │
│   ├── host/                   # Host-specific features
│   │   ├── HostLanding.tsx     # Server status + create game (existing, to refactor)
│   │   ├── HostGame.tsx        # Main game control view
│   │   ├── components/
│   │   │   ├── QuestionControls.tsx    # Question #, type selector, timer controls
│   │   │   ├── AnswerCard.tsx          # Team answer with scoring controls
│   │   │   ├── AnswerList.tsx          # Scrollable list of submitted answers
│   │   │   ├── Scoreboard.tsx          # Right panel with scores
│   │   │   ├── GameSettings.tsx        # Bottom bar (points, increment, timer)
│   │   │   └── SettingsModal.tsx       # Full settings modal
│   │   └── hooks/
│   │       └── useHostGame.ts          # Host game logic + WebSocket handling
│   │
│   └── team/                   # Team-specific features
│       ├── TeamFlow.tsx        # Single route managing all team steps
│       ├── components/
│       │   ├── JoinStep.tsx            # Game code + team name entry
│       │   ├── TeamInfoStep.tsx        # Team member names
│       │   ├── ColorSelectStep.tsx     # Color picker
│       │   ├── WaitingView.tsx         # "Submissions not open" state
│       │   ├── AnswerInput.tsx         # Answer submission form
│       │   ├── SubmittedView.tsx       # Post-submission confirmation
│       │   ├── ScoreLogModal.tsx       # Score history modal
│       │   └── TeamSettingsModal.tsx   # Team settings modal
│       └── hooks/
│           └── useTeamGame.ts          # Team game logic + WebSocket handling
│
├── stores/                     # Zustand stores
│   ├── useGameStore.ts         # Shared game state (connection, game code)
│   ├── useHostStore.ts         # Host-specific state (teams, answers, scores)
│   └── useTeamStore.ts         # Team-specific state (team info, submission state)
│
├── services/                   # External service integrations
│   ├── websocket.ts            # WebSocket connection manager
│   └── aws.ts                  # AWS SDK utilities (existing)
│
├── types/                      # TypeScript types
│   ├── messages.ts             # WebSocket message types (mirror backend)
│   ├── game.ts                 # Game-related types
│   └── team.ts                 # Team-related types
│
├── hooks/                      # Shared custom hooks
│   ├── useWebSocket.ts         # WebSocket connection hook
│   └── useTimer.ts             # Timer countdown hook
│
├── utils/                      # Utility functions
│   └── colors.ts               # Team color definitions + utilities
│
└── config.ts                   # Environment configuration (existing)
```

## Routing Structure

```tsx
// App.tsx
<Routes>
  {/* Public routes */}
  <Route path="/" element={<LandingPage />} />

  {/* Team routes (mobile-optimized) */}
  <Route path="/join" element={<TeamFlow />} />

  {/* Host routes (desktop-optimized, protected) */}
  <Route path="/host" element={<ProtectedRoute />}>
    <Route index element={<HostLanding />} />
    <Route path="game" element={<HostGame />} />
  </Route>

  {/* Future: Spectator view */}
  <Route path="/watch/:gameCode" element={<SpectatorView />} />

  <Route path="*" element={<NotFound />} />
</Routes>
```

## State Management Architecture

### Zustand Store Structure

```tsx
// stores/useGameStore.ts - Shared connection state
interface GameStore {
  socket: WebSocket | null;
  connectionState: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  gameCode: string | null;

  connect: (url: string) => Promise<void>;
  disconnect: () => void;
  send: (message: ClientMessage) => void;
}

// stores/useHostStore.ts - Host-specific state
interface HostStore {
  teams: Team[];
  currentQuestion: number;
  questionType: QuestionType;
  timerSeconds: number;
  timerRunning: boolean;
  answers: Map<string, TeamAnswer>;
  settings: GameSettings;

  // Actions populated by WebSocket handlers
  addTeam: (team: Team) => void;
  receiveAnswer: (teamName: string, answer: string) => void;
  scoreAnswer: (teamName: string, points: number) => void;
  // ...
}

// stores/useTeamStore.ts - Team-specific state
interface TeamStore {
  step: 'join' | 'info' | 'color' | 'game';
  teamName: string;
  teamColor: string;
  members: string[];
  submissionsOpen: boolean;
  currentAnswer: string | null;
  submitted: boolean;
  score: number;
  scoreLog: ScoreEntry[];

  setStep: (step: TeamStore['step']) => void;
  setTeamInfo: (name: string, members: string[]) => void;
  // ...
}
```

### WebSocket Message Flow

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   React     │         │  WebSocket  │         │   Zustand   │
│  Component  │         │   Service   │         │    Store    │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │  User Action          │                       │
       │──────────────────────>│                       │
       │                       │  send(ClientMessage)  │
       │                       │──────────────────────>│
       │                       │                       │ (via store action)
       │                       │                       │
       │                       │  onmessage            │
       │                       │<──────────────────────│ (from server)
       │                       │                       │
       │                       │  store.action()       │
       │                       │──────────────────────>│
       │                       │                       │
       │  Re-render (subscribed to store)              │
       │<──────────────────────────────────────────────│
       │                       │                       │
```

## Component Patterns

### Button Variants with Team Colors

```tsx
// components/ui/Button.tsx
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'team';
  teamColor?: string;  // Only used when variant='team'
  // ...
}

// TailwindCSS approach using CSS custom properties:
// The team color is set as a CSS variable on the parent container
// <div style={{ '--team-color': team.color }}>
//   <Button variant="team">Submit Answer</Button>
// </div>

// In Tailwind config or component:
// .btn-team { background-color: var(--team-color); }
```

### Team Flow Step Management

```tsx
// features/team/TeamFlow.tsx
export default function TeamFlow() {
  const { step, setStep } = useTeamStore();
  const { connectionState, gameCode } = useGameStore();

  // Handle browser back button
  useEffect(() => {
    const handlePopState = () => {
      // Navigate to previous step or exit
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [step]);

  return (
    <MobileLayout
      showBack={step !== 'join'}
      onBack={() => /* handle back navigation */}
    >
      {step === 'join' && <JoinStep />}
      {step === 'info' && <TeamInfoStep />}
      {step === 'color' && <ColorSelectStep />}
      {step === 'game' && <GameView />}
    </MobileLayout>
  );
}
```

### Modal Pattern

```tsx
// components/ui/Modal.tsx
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg p-6 max-w-md w-full mx-4">
        {title && <h2 className="text-xl font-bold mb-4">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
```

## TypeScript Types (Mirroring Backend)

```tsx
// types/messages.ts

// Client -> Server
export type HostAction =
  | { createGame: true }
  | { scoreAnswer: { teamName: string; answer: string } }
  | { reclaimGame: { gameCode: string } };

export type TeamAction =
  | { joinGame: { teamName: string; gameCode: string } }
  | { submitAnswer: { teamName: string; answer: string } };

export type ClientMessage =
  | { host: HostAction }
  | { team: TeamAction };

// Server -> Client
export type HostServerMessage =
  | { gameCreated: { gameCode: string } }
  | { newAnswer: { answer: string; teamName: string } }
  | { scoreUpdate: { teamName: string; score: number } };

export type TeamServerMessage =
  | { gameJoined: { gameCode: string } }
  | { answerSubmitted: true };

export type ServerMessage =
  | { host: HostServerMessage }
  | { team: TeamServerMessage }
  | { error: string };
```

## Question Type Components

Each question type will need corresponding input components for the team view:

```
features/team/components/answer-types/
├── StandardAnswer.tsx      # Single text input
├── MultiAnswer.tsx         # Multiple text inputs
├── MultipleChoice.tsx      # A/B/C/D buttons
├── WagerAnswer.tsx         # Point wager + answer
└── NumericAnswer.tsx       # Number input
```

The host view will show type-appropriate scoring UI for each.

## Team Colors

Define available colors in a central location:

```tsx
// utils/colors.ts
export const TEAM_COLORS = [
  { name: 'Orange', value: '#F97316' },
  { name: 'Forest Green', value: '#22C55E' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Yellow', value: '#EAB308' },
  // ... etc (matching mockup palette)
] as const;

export type TeamColor = typeof TEAM_COLORS[number]['value'];
```

## Responsive Design Strategy

| View | Target | Approach |
|------|--------|----------|
| Team views | Mobile (< 640px) | Single column, touch-friendly, full-width inputs |
| Host views | Desktop (> 1024px) | Multi-column layout, precise controls |
| Landing | Both | Responsive, mobile-first |

Use Tailwind breakpoints:
- Team views: Base styles (mobile-first)
- Host views: `lg:` prefix for desktop layouts

## Migration Path from Existing Code

1. **Keep existing files** initially; refactor incrementally
2. **Add Zustand** - install and create stores
3. **Extract components** - move reusable UI from HostLanding.tsx to components/ui/
4. **Add team flow** - new route and components
5. **Refactor host flow** - split HostLanding into HostLanding + HostGame
6. **Add TypeScript types** - create types/messages.ts matching backend

## Dependencies to Add

```json
{
  "dependencies": {
    "zustand": "^5.0.0"
  }
}
```

No other dependencies are needed - the existing stack covers all requirements.
