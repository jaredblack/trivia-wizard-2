We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

## near future
- lots of unwraps now that we made host_tx and option -- we need to handle that better

## misc
- Use wss/https to secure traffic
- send over authn token with first host msg, otherwise reject. teams don't need authn
- store the Cognito ids somewhere central -- right now they're duplicated and embedded in source code. even though they're not secrets this isn't an ideal situation.
- update verification email
- set an alarm on log::error from my app?

## questions
- is it going to be a problem if we immediately delete the game when the host disconnects? maybe we should add a timer before doing that as well. would we need special logic to replace

## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host