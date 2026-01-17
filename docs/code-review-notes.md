## Egregious Issues That Must Be Fixed
## Kinda gross but probably fine
1. Because I was insistent on using the same TeamQuestion type in both GameState and TeamGameState, we now have the question config duplicated across every single answer that gets submitted, which is just unnecessary data for the server to keep duplicated and makes the GameState that the server is sending bigger than it needs to be. If I'm ever looking to shrinkify GameState, that's probably a good place to start.
    - I think we really need separate types there. "What are all the answers from all teams for a given question?" vs. "What are all the questions, including ones that don't have responses, for a single team?" are pretty different questions and it's a bit weird that we use a Vec<TeamQuestion> to represent both
2. QuestionConfig and QuestionKind also provide duplicate info in game state. We need question kind without config for game settings currently, but one could imagine getting rid of that. At the very least, I think places like TeamAnswerView where we're checking both things seems kinda wrong.
3. Now that we send score updates for one team to all teams, it's possible that we don't need the single team broadcast anymore and things can be updated. Or, it's also possible we need to be smarter about which teams we're sending score updates to based on auto-scoring
## bug backlog
- If we get these errors, we gotta yeet the channel: 
```
[2026-01-16T03:46:58Z ERROR backend::model::server_message] Sending server message through channel failed: channel closed
[2026-01-16T03:46:58Z ERROR backend::model::server_message] Tried to send message: {"type":"timerTick","secondsRemaining":584}
```