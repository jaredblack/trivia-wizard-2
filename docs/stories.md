We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.
## near future
- Need strongly typed frontend model classes. Lots of gotchas especially for the LLM around the serde rename traits


## misc
- update verification email
- set an alarm on log::error from my app?
- game db lifecycle - I've never actually gone back to look at old trivia games since they're not that interesting. maybe they shouldn't really be persisted
for that long? I think no DB at all, while removing a dependency which would be nice, would just be asking for trouble


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host
