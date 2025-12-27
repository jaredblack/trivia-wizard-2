We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

---

Hello! Today we are going to plan the implementation for basic team joining functionality in Trivia Wizard. All of the
backend functionality supporting this UI is already in place. I will explain the basic flow, which is also 
represented in the images I provided. All of these views will have a header with the Trivia Wizard 2.0 logo, and
for items 2-4, there will be a back chevron which will take the team back to the previous view (preserving previously entered data.):
1. Team selects "Join game". The client establishes a websocket connection to the backend (technically this is earlier than necessary, but later we'll want to add a call here to check that the game code/team name are valid before continuing on so we'll put the initial WS connection here for now).
2. Team inputs game code & team name, presses "next"
3. Team sees a new view consisting of a single text input, a button to add more text inputs, and a "Next" 
button. On this view, they'll input the names of all team members before pressing "Next", pressing the + button 
to add more team member names if needed
4. Team will see a color selection screen consisting of 16 color choices. The team will select a color, the 
button below will dynamically update to say "Choose <color name>". When they press that button, all of the data 
necessary to join the game will have been collected, and the client will send a JoinGame action to the server. NOTE: this means game code & team name won't be validated until the end of the flow. This is an intentional simplification. Later we will add another action to validate those things before fully joining the game.

Once the game is joined, we'll go to a placeholder in-game view where we will later add all the answer submission UI.

The backend operation (JoinGame) is already available for this. Additionally, the host UI is 
already implemented. In creating an implementation plan for what I described, you should explore the code to see
 what you'll need to add.

An error returned from the server on the JoinGame operation will display a toast and send the user back to the screen where they should input game code.

It may also help to consult frontend-structure.md.

These views will be all optimized for mobile layouts as they are in the mocks. What questions do you have for me
 before planning and then implementing this? 


1. If successful, the team will now be in-game. There are three views here. All views have a header (below the 
logo header) with team color, team name, question number, and the game timer.
a. "Submissions are not yet open". The View Score Log and Team Settings buttons will be available on the bottom 
of the screen.
b. Score input. This will vary by Question Type. For the Standard question type (which is the only question type
 we are implementing for now), it will be a single multi-line text input and a "Submit answer" button. This 
button will have a background color of the team color.
c. "Submissions closed." This view will also show what answer the team submitted for the current question. This 
view will again have the View Score Log and Team Settings buttons. These buttons will just be stubs for now, but
 in the future they will open modals on top of the current view.

The three views can roughly be thought of as following a state machine:
S0: New question created (a) -> S1: Answers are open (b) -> S2 -> Answer submitted (c).
  - "Submissions not yet open": timerRunning === false AND team has no answer for current question
  - "Answer input": timerRunning === true
  - "Submissions closed": timerRunning === false AND team has submitted answer for current question


When the host navigates to a new question, we go will back to S0. If the host navigates to an old question, the 
team will see view C with the old answer they submitted for that question.


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
- Add a PartialJoin (need a better name) API for the frontend to call after you put in a game code/team name to verify that (a) game code is valid and (b) team name is available

## concerns
- The big game state Mutex<HashMap> gets touched _a lot_. We're not doing anything expensive while holding the lock (I think), but intuitively it feels like there could be contention which could lead to issues in when messages get processed, timer updates going out on time, etc. I think for now we continue down this path but if things look problematic in testing, we might have to consider a radically different architecture.
   - Likely that it will be fine for 1-2 games happening at the same time, but more than that... there may be some contention. Would be interesting to benchmark somehow. Hopefully it will never matter
   - There's probably a way to have the lock only be per-game instead of per-games. A fixed array of games maybe? Would be interesting to look into


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host
