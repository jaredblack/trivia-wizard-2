We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.


## misc
- Use wss/https to secure traffic
- send over authn token with first host msg, otherwise reject. teams don't need authn
- store the Cognito ids somewhere central -- right now they're duplicated and embedded in source code. even though they're not secrets this isn't an ideal situation.
- update verification email