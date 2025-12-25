We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

---

## Story: Real-Time Game State Synchronization

**Goal:** Implement WebSocket-based game state sync between teams and host, including answer submission, scoring, and timer functionality.

**Scope:**
- Standard questions only (no multiAnswer or multipleChoice)
- Single question (no nextQuestion/prevQuestion navigation)
- Timer with auto-close on expiry
- Host frontend changes only (team frontend out of scope)
- Backend test updates included
- Fixed game settings (50 point questions, 5 point bonus increment) — not configurable

---

### Phase 1: Backend Game State Model

Extend the `Game` struct in `backend/src/model/game.rs` to hold the full game state per the proposed API shape.

**Tasks:**

1. **Expand `Game` struct** to include:
   - `current_question_number: u32` (always 1 for this iteration)
   - `timer_running: bool` (also determines if submissions are open)
   - `timer_seconds_remaining: Option<u32>`
   - `teams: Vec<TeamData>`
   - `questions: Vec<Question>` (will have exactly 1 question)
   - `game_settings: GameSettings`

2. **Add `GameState` response type** in `server_message.rs`:
   - Serializable struct matching `proposed-api-shape.md`
   - Method `Game::to_game_state()` to convert internal state to wire format

3. **Add `TeamGameState` response type**:
   - Filtered view for teams (no other teams' answers, no scoring details)
   - Method `Game::to_team_game_state(team_name: &str)`

4. **Initialize game state on creation**:
   - Start with 1 empty standard question
   - Hardcoded `GameSettings`: 30s timer, 50 point questions, 5 point bonus increment, standard type
   - `submissions_open: false`, `timer_running: false`

---

### Phase 2: Backend Message Handlers

Update `server.rs` to handle the host and team actions that mutate game state.

**Tasks:**

1. **Update `HostAction` enum** in `client_message.rs`:
   - `StartTimer { seconds: Option<u32> }`
   - `PauseTimer`
   - `ResetTimer`
   - `ScoreAnswer { question_number: u32, team_name: String, score: ScoreData }`
   - `OverrideTeamScore { team_name: String, override_points: i32 }`

   Note: No separate OpenSubmissions/CloseSubmissions — submissions are open iff timer is running.

2. **Update `ServerMessage` enum** in `server_message.rs`:
   - `GameState { state: GameState }` — full state update
   - `TimerTick { seconds_remaining: u32 }` — lightweight tick
   - `Error { message: String, state: Option<GameState> }` — error with optional rollback state

3. **Implement handler for `ScoreAnswer`**:
   - Find the team's response in `questions[0].responses`
   - Update the `ScoreData` on that response
   - Recalculate team's cumulative score
   - Broadcast updated state to host AND the scored team

5. **Implement handler for `OverrideTeamScore`**:
   - Update the team's `score.override_points`
   - Broadcast updated state to host and team

6. **Update `SubmitAnswer` handler**:
   - Only accept if `timer_running == true` (submissions open)
   - Append `TeamResponse` to `questions[0].responses` with zeroed score
   - Broadcast updated `GameState` to host
   - Send `TeamGameState` to the submitting team

7. **Update `JoinGame` handler**:
   - Add team to `teams` array with zeroed score and `connected: true`
   - Broadcast updated `GameState` to host
   - Send `TeamGameState` to the joining team

8. **Handle team disconnect**:
   - Set `team.connected = false`
   - Broadcast updated state to host

---

### Phase 3: Backend Timer Implementation

Implement server-side timer with tick broadcasts.

**Tasks:**

1. **Add timer task infrastructure**:
   - Store `timer_handle: Option<JoinHandle>` in `Game` to track running timer task
   - Timer task sends `TimerTick` every second to host + all teams

2. **Implement `StartTimer` handler**:
   - If `seconds` provided, use that; otherwise use `timer_seconds_remaining` or 30s default
   - Set `timer_running = true` (opens submissions)
   - Spawn async task that:
     - Decrements `timer_seconds_remaining` each second
     - Broadcasts `TimerTick` to all connections
     - On reaching 0: sets `timer_running = false`, broadcasts full `GameState`
   - Broadcast `GameState` immediately

3. **Implement `PauseTimer` handler**:
   - Cancel the timer task
   - Set `timer_running = false` (closes submissions)
   - Keep `timer_seconds_remaining` at current value
   - Broadcast `GameState`

4. **Implement `ResetTimer` handler**:
   - Cancel the timer task if running
   - Set `timer_seconds_remaining = 30` (hardcoded default)
   - Set `timer_running = false`
   - Broadcast `GameState`

---

### Phase 4: Frontend WebSocket Service

Create a persistent WebSocket connection for the host during gameplay.

**Tasks:**

1. **Create `frontend/src/services/websocket.ts`**:
   - `WebSocketService` class or module
   - `connect(url: string): Promise<void>`
   - `disconnect(): void`
   - `send(message: ClientMessage): void`
   - `onMessage(handler: (msg: ServerMessage) => void): void`

2. **Create `frontend/src/hooks/useWebSocket.ts`**:
   - Hook that wraps `WebSocketService`
   - Returns `{ send, connectionState }`
   - Handles cleanup on unmount

3. **Update `HostLanding.tsx`**:
   - After game creation, navigate to `/host/game` with WebSocket still connected
   - Pass WebSocket connection via context or keep in service singleton

4. **Update `HostGame.tsx`**:
   - Use `useWebSocket` hook
   - On mount, if not connected, redirect to `/host`

---

### Phase 5: Frontend State Updates

Update Zustand store and components to handle real-time state updates.

**Tasks:**

1. **Expand `useHostStore`**:
   - Add all `GameState` fields
   - Add `setGameState(state: GameState)` action that replaces entire state
   - Add `handleTimerTick(seconds: number)` action

2. **Wire WebSocket messages to store**:
   - In `useWebSocket` or a dedicated effect in `HostGame`:
     - On `gameState` message → `setGameState(state)`
     - On `timerTick` message → `handleTimerTick(seconds)`
     - On `error` message → show toast/alert, optionally rollback state

3. **Update `AnswerCard.tsx`**:
   - On score button click, call `send({ host: { type: "scoreAnswer", ... } })`
   - Remove local scoring state (let server be source of truth)
   - Display score from props (server state)

4. **Update `Scoreboard.tsx`**:
   - On override score edit, call `send({ host: { type: "overrideTeamScore", ... } })`
   - Display scores from store

5. **Update `QuestionControls.tsx`**:
   - Timer play button → `send({ host: { type: "startTimer" } })`
   - Timer pause button → `send({ host: { type: "pauseTimer" } })`
   - Timer reset button → `send({ host: { type: "resetTimer" } })`
   - Display `timerSecondsRemaining` from store

   Note: Submissions are controlled via timer — no separate open/close button needed.

---

### Phase 6: Backend Tests

Update the existing test suite in `backend/tests/`.

**Tasks:**

1. **Update existing tests** to work with new message format

2. **Add tests for**:
   - Team join broadcasts `GameState` to host
   - Answer submission broadcasts `GameState` to host
   - Score answer updates state for host and team
   - Timer start/pause/reset behavior
   - Timer reaching 0 closes submissions (timer_running = false)
   - Submissions rejected when timer not running
   - Override team score

---

### Acceptance Criteria

- [ ] Host creates game → sees empty game state with 1 question
- [ ] Team joins → host sees team appear in real-time
- [ ] Host starts timer → submissions open, timer ticks down on host view
- [ ] Team submits answer (while timer running) → host sees answer appear in real-time
- [ ] Host scores answer → score reflected in host view AND team receives update
- [ ] Timer reaches 0 → submissions auto-close (timer_running = false)
- [ ] Host can pause timer (closes submissions) and resume
- [ ] Host can reset timer
- [ ] Host can override team total score
- [ ] All backend tests pass

We need to implement two new Host actions: UpdateGameSettings and UpdateQuestionSettings. Game settings can be updated at any time, but updates to settings will always only apply to (1) any question in the game's state that has not yet received any answers and (2) all questions that are subsequently created for the game. Settings updates will not apply to questions which have already received answers. UpdateQuestionSettings override the game settings on a per-question basis, with the same rule: question settings may not be updated once answers have started to be recived. This will require changes in the backend/ to add the new operations, and in the frontend to wire up the currently existing host settings UI to these operations. No team UI changes will be needed. The server should return an error in the event that these conditions are violated. Please create a plan for making this change that I can approve, then move forward with implementation. Be sure to ask me any clarifying questions as well. 

## CR comments
- [ ] still just stringifying JSON in create game, should be using strong types
   - this will be resolved with the frontend tasks
- [ ] model types are still a bit of a mess, to be fair I just told it to modify stuff that it needed to. But we need to go through and make sure that the model types exactly match in frontend/backend
- [x] having a separate currentQuestion field on the GameState that's constantly being sent over the wire seems kind of dumb. questions[currentQuestionNumber - 1]. Bang. Easy
- [x] can probably drop peer after logging it, no need to pass it along. tbh, I don't think we need to even log it
- [x] Current ReclaimGame just calls create_game with a game code. Need to collapse this into a single API
   - Also need to validate that user id matches when reclaiming a game
- handle_connection is still pretty dang deeply nested. not seeing a place to cleanly break it up without adding unnecessary indirection. not too concerned for now tbh
- [x] looks like there may be a bug in create_game where if the game code is in the map & there is already a connected host, it will get overwritten. need to write a test case for this: new host tries to "reclaim" game that already has a host
- [x] process_host_action, process_host_message, and handle_host should be factored into their own file. same for the team message processing
- [x] I need claude to explain why the timer actions need to be handled separately. They need to spawn tasks, but fundamentally it's the same type of thing where we have a message to send to all the clients. Right now process_host_action can only return something back to send to one team but this will pretty quickly not work either for operations like NextQuestion
   - Possibility: have HostActionResult optionally provide the team_tx to send the team message to. If it's not provided, then send the message to all teams.
- [x] Game::recalculate_team_score seems a bit inefficient -- I think recalculating the score fully every time feels like overkill. Actually, now that I think of it a little more, this is necessary so that multiple score updates for the same answer don't stack. Another solution to this could be to have the host always only send the diff between the existing score and the updated score. The current approach seems fine though.
- [x] ClearAnswerScore seems unnecessary. I feel like the client can just send a score update of 0 in this case and it will be fine
- should add color name to JoinGame message
- [x] broadcast_game_state shouldn't be in game_timer, as noted above we'll need it for other actions
- [x] do we have a test for a team leaving and rejoining? I'm not sure that's working right now
- the default 30s timer on line 58 is suspect. In fact, I think that function can be simplified if we make the seconds parameter to StartTimer be required. I don't see why it shouldn't be.
   - I guess from a "server authority" perspective it makes sense to have it not take a parameter. Instead, to start the timer, the server should read the question settings. Then, when starting the timer after it's been paused, read the remaining time off of the game state. So, similar to what's there, but removing the optional parameter from StartTimer entirely (opposite of what I said above)
- There may be an edge case where when StartTimer is called with 0 seconds, the submissions get opened, but they don't close.
- [x] It seems unnecessary to me if the timer needs to send out a state update when it's down to 0. 
   - Well, actually, I guess there will be the update that submissions are now closed. So never mind.
- [x] handle_reset_timer needs to get the timer length off of the question settings.
- [x] AppState is a singleton, but we're passsing it around anywhere. Is there a point? Is there a Rust-friendly Singleton pattern?

## soonish
- Words as game codes: I think bundling up some list of a few thousand words that can be random game codes seems reasonable enough. I don't think we need to do an external API call like in TW1
- game settings updates should update the current question's settings iff there are no answers already for that question (which should be the same condition as being able to update question settings). there should be a warning on the game settings modal if you're trying to update after answers have come in: this won't update the current question (and also it won't retroactively change questions)
- definitely need to add some server tests around scoring. as part of that, should break up websocket_tests into multiple semantically grouped files

## potential refactors
- [ ] this block seems to be repeated (but this will also need to change with the above changes to HostActionResult):
```
let host_msg = ServerMessage::GameState {
   state: game.to_game_state(),
};
let team_msg = game.teams_tx.get(&team_name).cloned().and_then(|tx| {
   game.to_team_game_state(&team_name)
      .map(|state| (tx, ServerMessage::TeamGameState { state }))
});
```
- [ ] at least two places where I'm returning the same deser error "Server error: Failed to parse message" - can probably make that a helper

## misc
- update verification email
- set an alarm on log::error from my app?
- game db lifecycle - I've never actually gone back to look at old trivia games since they're not that interesting. maybe they shouldn't really be persisted for that long? I think no DB at all, while removing a dependency which would be nice, would just be asking for trouble. The way things are going now, we'll start with no persistence and then figure out what the best way to do it is. Writing to a DB with every operation like I did for TW1 feels unnecessary when the server can track the state that realistically only needs to be temporary. One halfway option could be just serializing the whole game state every once in a while and writing it to S3 or a document DB? 
- submissions should auto-close when all answers have been received
- Also need to validate that user id matches when reclaiming a game

## concerns
- The big game state Mutex<HashMap> gets touched _a lot_. We're not doing anything expensive while holding the lock (I think), but intuitively it feels like there could be contention which could lead to issues in when messages get processed, timer updates going out on time, etc. I think for now we continue down this path but if things look problematic in testing, we might have to consider a radically different architecture.
   - Likely that it will be fine for 1-2 games happening at the same time, but more than that... there may be some contention. Would be interesting to benchmark somehow. Hopefully it will never matter
   - There's probably a way to have the lock only be per-game instead of per-games. A fixed array of games maybe? Would be interesting to look into


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host
