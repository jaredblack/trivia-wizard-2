We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

---

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
- [I think this is done] game settings updates should update the current question's settings iff there are no answers already for that question (which should be the same condition as being able to update question settings). there should be a warning on the game settings modal if you're trying to update after answers have come in: this won't update the current question (and also it won't retroactively change questions)

## pre-IA (Jan trivia night)
- Investigate "Failed to parse message: EOF while parsing a value at line 1 column 0"
- Game code/team name validation immediately, not at the end of the flow
   - Make sure we're trimming team names. Also should probably match case-insensitive
   - I think this could also help as a shortcut for rejoiners
- The "submissions closed" screen should only show if the timer got to 0, not just if it opened then closed (well, unless they submitted an answer)
- Multiple choice question type
- At least one other question type, possibly based on the questions that I write for this trivia night (probably multi-answer)

## ideally also
- auto-score identical answers
   - game settings toggle for if it should do this at all, and if it should match bonus points or just base points
- automatically applied speed bonuses

# future playwright test cases
- auto-submit

# Current Status:
- Most tests failing. They need to call ValidateJoin first
- Auto-rejoin currently broken. They need to be modified to just call ValidateJoin (this is a simplifier as we no longer have to serialize/store color/member info)

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
   - I need to be able to have old games for Amy's usecase
- submissions should auto-close when all answers have been received
- Also need to validate that user id matches when reclaiming a game
- Add a PartialJoin (need a better name) API for the frontend to call after you put in a game code/team name to verify that (a) game code is valid and (b) team name is available
- favicon


## beta
- need a ranking question type
- it's showing nick as disconnected but he can stil submit

## concerns
- The big game state Mutex<HashMap> gets touched _a lot_. We're not doing anything expensive while holding the lock (I think), but intuitively it feels like there could be contention which could lead to issues in when messages get processed, timer updates going out on time, etc. I think for now we continue down this path but if things look problematic in testing, we might have to consider a radically different architecture.
   - Likely that it will be fine for 1-2 games happening at the same time, but more than that... there may be some contention. Would be interesting to benchmark somehow. Hopefully it will never matter
   - There's probably a way to have the lock only be per-game instead of per-games. A fixed array of games maybe? Would be interesting to look into


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host
