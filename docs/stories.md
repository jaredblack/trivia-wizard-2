# Backlog

## Definitely doing
- circle back on Geoguessr algorithm for Map as it may need to be calibrated to better fit our typical point totals (50)
- "Connecting..." -> timeout currently leads to nowhere, just a blank screen with an error toast
   - we really need to use the health check endpoint here to enable/disable the button instead of blindly trying to connect to WS

## Nice to have
- should upgrade deps
- more improvements to range
   - rename/possibly reorganize settings, make more clear how many points will be given
- set an alarm on log::error from my app?
- favicon
- should probably chill with the console.logs especially in websocket.ts
- CI/CD
- a "half points" button on standard question type scoring
- End of game stats - graph showing teams' trajectories, % overall correct

## Maybe worth doing
- Words as game codes: I think bundling up some list of a few thousand words that can be random game codes seems reasonable enough. I don't think we need to do an external API call like in TW1
- update verification email
- If I see more bugs where the server thinks a team is connected even when they're not, could add an option for the host to force disconnect a team.
- Per-question point breakdown for host

# Bug reports
- Phone keyboard doesn't have negative (2026-02-11)
- Getting "team name already in use" for some reason even though it's the same phone :( could somehow have to do with "Other" multiple choice? (2026-02-11)
   - Potential root cause: local development - hot reload causes state to be cleared while WS stays active. Should watch to see if this pops up in production
- Joe got kicked out with an "Already validated" once (2026-01-24)
- BYU WiFi refusing to connect to backend?! (2026-01-30)

# Other

## concerns
- The big game state Mutex<HashMap> gets touched _a lot_. We're not doing anything expensive while holding the lock (I think), but intuitively it feels like there could be contention which could lead to issues in when messages get processed, timer updates going out on time, etc. I think for now we continue down this path but if things look problematic in testing, we might have to consider a radically different architecture.
   - Likely that it will be fine for 1-2 games happening at the same time, but more than that... there may be some contention. Would be interesting to benchmark somehow. Hopefully it will never matter
   - There's probably a way to have the lock only be per-game instead of per-games. A fixed array of games maybe? Would be interesting to look into
- game.rs continues to get more bloated -- we can probably factor some stuff, for example tests and map calculation utils

## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host
- would be good to add testing around mashing the submit button, especially if there's a slow connection. not sure when/if it disables rn
