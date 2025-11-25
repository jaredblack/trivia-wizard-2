We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

## near future
- Reconnection will fail once the game code isn't hardcoded. Need to accept an (optional?) parameter with CreateGame to supply a game code
- lots of unwraps now that we made host_tx and option -- we need to handle that better

## misc
- Use wss/https to secure traffic
- send over authn token with first host msg, otherwise reject. teams don't need authn
- store the Cognito ids somewhere central -- right now they're duplicated and embedded in source code. even though they're not secrets this isn't an ideal situation.
- update verification email
- set an alarm on log::error from my app?


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host