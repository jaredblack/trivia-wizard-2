We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

---

## soonish
- Words as game codes: I think bundling up some list of a few thousand words that can be random game codes seems reasonable enough. I don't think we need to do an external API call like in TW1
- [I think this is done] game settings updates should update the current question's settings iff there are no answers already for that question (which should be the same condition as being able to update question settings). there should be a warning on the game settings modal if you're trying to update after answers have come in: this won't update the current question (and also it won't retroactively change questions)

## pre-IA (Jan trivia night)
- At least one other question type, possibly based on the questions that I write for this trivia night (probably multi-answer)


# future playwright test cases
- auto-submit

## misc
- update verification email
- set an alarm on log::error from my app?
- submissions should auto-close when all answers have been received
- Also need to validate that user id matches when reclaiming a game
- favicon
- should probably chill with the console.logs especially in websocket.ts
- CI/CD


## concerns
- The big game state Mutex<HashMap> gets touched _a lot_. We're not doing anything expensive while holding the lock (I think), but intuitively it feels like there could be contention which could lead to issues in when messages get processed, timer updates going out on time, etc. I think for now we continue down this path but if things look problematic in testing, we might have to consider a radically different architecture.
   - Likely that it will be fine for 1-2 games happening at the same time, but more than that... there may be some contention. Would be interesting to benchmark somehow. Hopefully it will never matter
   - There's probably a way to have the lock only be per-game instead of per-games. A fixed array of games maybe? Would be interesting to look into


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host
- would be good to add testing around mashing the submit button, especially if there's a slow connection. not sure when/if it disables rn

## beta test 2
- Already validated errors post-submission but then it let people back in
   - it's kicking people out only to let them back in for the next question
- Team score log is broken
- submissions are not yet open showing when timer is closed and they've answered

## fast follows
- don't fully boot people from the game for error responses unless totally necessary
- improve overall reconnection experience. more buttons to just explicitly clear and try again.
- requiring JoinGame after ValidateJoin doesn't work well for failed reconnections. I would try to reconnect, see that I got to the team member input screen, know I must have put in team name wrong, go back, and then it would yell at me
   - realistically the solution here is terminating the WS connection if you go back. We gotta wait to establish the connection until the team name gets put in

log dive:
```
[2026-01-22T01:40:21Z ERROR backend::server] Expected ValidateJoin from new Team connection, instead got: SubmitAnswer { team_name: "Nerds of a Feather", answer
```
