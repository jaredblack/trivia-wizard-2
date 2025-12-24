# Proposed API Shape

This document outlines the WebSocket message types for Trivia Wizard 2.

## Design Principles

1. **Server is the source of truth** - clients never dictate state, only request changes
2. **Full state sync** - server always sends complete game state on any update
3. **Action-based client messages** - clients send semantic intents, not state blobs
4. **Optimistic updates with auto-rollback** - clients update locally, server state corrects if needed

---

## Core Types

These align with the existing types in `frontend/src/types.ts`.

### QuestionKind

```
QuestionKind = "standard" | "multiAnswer" | "multipleChoice"
```

### ScoreData

Scores are tracked as three components to support bonus points and manual overrides:

```
ScoreData {
  questionPoints: number      // Base points earned for the answer
  bonusPoints: number         // Speed/order bonus points
  overridePoints: number      // Manual adjustments by host
}

// Total score = questionPoints + bonusPoints + overridePoints
```

### TeamColor

```
TeamColor {
  hexCode: string             // e.g. "#F97316"
  name: string                // e.g. "Orange"
}
```

### TeamData

```
TeamData {
  teamName: string
  teamMembers: string[]
  teamColor: TeamColor
  score: ScoreData            // Cumulative score across all questions
  connected: boolean          // WebSocket connection status
}
```

---

## Response Types

Responses are stored in arrays to preserve submission order (first to last).

### TeamResponse (for standard and multiple choice)

```
TeamResponse {
  teamName: string
  answerText: string
  score: ScoreData
}
```

### MultiAnswerResponse (for multi-answer questions)

```
MultiAnswerResponse {
  teamName: string
  subAnswers: Record<string, boolean>   // answer text -> correct (all initially false)
  score: ScoreData                      // Aggregate score for the whole response
}
```

For multi-answer questions, `score.questionPoints = n_correct * questionSettings.questionPoints`. Bonus points are based on submission order of the aggregate response, not per sub-answer. When a team submits, all sub-answers are initially mapped to `false`; the host marks each correct one as `true`.

---

## Question Data (Discriminated Union)

Each question type has its own data shape:

```
StandardQuestionData {
  type: "standard"
  responses: TeamResponse[]
}

MultiAnswerQuestionData {
  type: "multiAnswer"
  responses: MultiAnswerResponse[]
}

MultipleChoiceQuestionData {
  type: "multipleChoice"
  choices: string[]                   // e.g. ["A", "B", "C", "D"]
  responses: TeamResponse[]
}

QuestionData = StandardQuestionData | MultiAnswerQuestionData | MultipleChoiceQuestionData
```

---

## Question

Per-question settings plus the response data:

```
Question {
  timerDuration: number       // Seconds for this question (0 = no timer)
  questionPoints: number      // Base points for this question
  bonusIncrement: number      // Points deducted per position (1st gets full, 2nd gets -increment, etc.)
  questionData: QuestionData
}
```

**Immutability note**: These settings are initialized from `GameSettings.default*` when the question is created, but remain editable until the first answer is scored. Once scoring begins for a question, its settings are locked to prevent unfair recalculation of already-scored answers.

---

## GameSettings

Default values applied to new questions:

```
GameSettings {
  defaultTimerDuration: number
  defaultQuestionPoints: number
  defaultBonusIncrement: number
  defaultQuestionType: QuestionKind
}
```

---

## GameState (Server → Host)

The complete game state, sent on every update.

```
GameState {
  gameCode: string

  // Current position
  currentQuestionNumber: number       // 1-indexed

  // Timer state (submissions are open iff timerRunning is true)
  timerRunning: boolean
  timerSecondsRemaining: number | null

  // Participants
  teams: TeamData[]

  // All questions (index 0 = question 1)
  questions: Question[]

  // Current question (convenience, same as questions[currentQuestionNumber - 1])
  currentQuestion: Question

  // Global settings
  gameSettings: GameSettings
}
```

### Notes on GameState

- `teams[].score` contains cumulative scores (computed server-side from all question responses)
- `questions` array contains all questions with their responses and per-question settings
- `currentQuestion` is duplicated for convenience (avoids index math on client)
- Response arrays preserve submission order for bonus point calculation
- **Submissions are open iff `timerRunning` is true** — no separate submissions state

---

## Server Messages

```
ServerMessage =
  | { type: "gameState", state: GameState }
  | { type: "error", message: string, state?: GameState }
  | { type: "timerTick", secondsRemaining: number }
```

Notes:
- The `error` variant optionally includes state for rollback after a failed optimistic update.
- `timerTick` is an exception to the "always send full state" rule. The server maintains the authoritative timer and broadcasts a lightweight tick each second to all connected clients (host + teams). When the timer reaches 0, the server sends a full `gameState` with `timerRunning: false`.

### Team-Specific View (Server → Team)

Teams receive a filtered state:

```
TeamGameState {
  gameCode: string
  currentQuestionNumber: number

  // Timer (submissions are open iff timerRunning is true)
  timerRunning: boolean
  timerSecondsRemaining: number | null

  // This team's info
  team: TeamData

  // Current question settings (so team knows input type)
  currentQuestionKind: QuestionKind
  currentQuestionChoices?: string[]   // Only for multipleChoice

  // This team's history (for score log view)
  questionHistory: {
    questionNumber: number
    response: TeamResponse | MultiAnswerResponse
  }[]
}
```

### Spectator View (Server → Spectator)

```
SpectatorGameState {
  gameCode: string
  currentQuestionNumber: number

  // Public team info + scores only
  teams: {
    teamName: string
    teamColor: TeamColor
    totalScore: number
  }[]
}
```

---

## Client Messages

### Host Actions

```
HostAction =
  // Game lifecycle
  | { type: "createGame" }
  | { type: "rejoinGame", gameCode: string }

  // Question navigation
  | { type: "nextQuestion" }
  | { type: "prevQuestion" }

  // Timer (controls submissions: running = open, paused = closed)
  | { type: "startTimer", seconds?: number }
  | { type: "pauseTimer" }
  | { type: "resetTimer" }

  // Scoring (standard / multiple choice)
  | { type: "scoreAnswer", questionNumber: number, teamName: string, score: ScoreData }
  | { type: "clearAnswerScore", questionNumber: number, teamName: string }

  // Scoring (multi-answer) - toggle sub-answer correctness; server recalculates aggregate score
  | { type: "markSubAnswer", questionNumber: number, teamName: string, answerText: string, correct: boolean }

  // Override total score
  | { type: "overrideTeamScore", teamName: string, overridePoints: number }

  // Question settings (rejected if question has any scored answers)
  | { type: "updateQuestionSettings", questionNumber: number, settings: Partial<Question> }

  // Game settings
  | { type: "updateGameSettings", settings: Partial<GameSettings> }
```

### Team Actions

```
TeamAction =
  | { type: "joinGame", gameCode: string, teamName: string }
  | { type: "updateTeamInfo", teamMembers?: string[], teamColor?: TeamColor }
  | { type: "submitAnswer", answerText: string }
  | { type: "submitMultiAnswer", answers: string[] }
```

### Wrapper

```
ClientMessage =
  | { host: HostAction }
  | { team: TeamAction }
```

---

## Message Flow Examples

### Host Creates Game

```
Client: { host: { type: "createGame" } }
Server: { type: "gameState", state: GameState }
```

### Team Joins

```
Client: { team: { type: "joinGame", gameCode: "FANCY", teamName: "Quiz Khalifa" } }
Server → Team: { type: "gameState", state: TeamGameState }
Server → Host: { type: "gameState", state: GameState }  // includes new team
```

### Host Scores Answer (Optimistic)

```
1. Host clicks +10 for Team A on Q3 (first to submit, so gets bonus)
2. Client optimistically updates local state
3. Client sends: { host: { type: "scoreAnswer", questionNumber: 3, teamName: "Team A", score: { questionPoints: 10, bonusPoints: 2, overridePoints: 0 } } }
4. Server updates, broadcasts: { type: "gameState", state: GameState }
5. Client replaces local state with server state
```

### Bonus Points Flow

```
1. Host starts timer → submissions open
2. Team A submits first → server records position 0
3. Team B submits second → server records position 1
4. Timer expires (or host pauses) → submissions close
5. Host scores all correct with questionPoints: 10, bonusIncrement: 2
   - Team A gets: questionPoints: 10, bonusPoints: 2 (first)
   - Team B gets: questionPoints: 10, bonusPoints: 0 (second)
```

