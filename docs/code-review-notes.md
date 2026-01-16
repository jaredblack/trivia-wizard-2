## Egregious Issues That Must Be Fixed
1. If you change multiple choice config, then the regular question config, the multiple choice config gets overwritten with the defaults.
    - This reveals a slightly bigger issue: UpdateQuestionSettings has an McConfig when it should have a generic QuestionConfig for compatibility with other question types
    - Should UpdateQuestionSettings have the question_config sent along every time? Or should the backend just copy over the old config if it's not supplied?
## Kinda gross but probably fine
1. Because I was insistent on using the same TeamQuestion type in both GameState and TeamGameState, we now have the question config duplicated across every single answer that gets submitted, which is just unnecessary data for the server to keep duplicated and makes the GameState that the server is sending bigger than it needs to be. If I'm ever looking to shrinkify GameState, that's probably a good place to start.
    - I think we really need separate types there. "What are all the answers from all teams for a given question?" vs. "What are all the questions, including ones that don't have responses, for a single team?" are pretty different questions and it's a bit weird that we use a Vec<TeamQuestion> to represent both
2. QuestionConfig and QuestionKind also provide duplicate info in game state. We need question kind without config for game settings currently, but one could imagine getting rid of that. At the very least, I think places like TeamAnswerView where we're checking both things seems kinda wrong.

## bug backlog
- If we get these errors, we gotta yeet the channel: 
```
[2026-01-16T03:46:58Z ERROR backend::model::server_message] Sending server message through channel failed: channel closed
[2026-01-16T03:46:58Z ERROR backend::model::server_message] Tried to send message: {"type":"timerTick","secondsRemaining":584}
```
- Also seeing empty validateJoins being sent when attempting to reconnect:
```
[2026-01-16T03:55:06Z INFO  backend::server] Received message: {"team":{"validateJoin":{"gameCode":"","teamName":""}}}
[2026-01-16T03:55:06Z INFO  backend::server] Parsed message: Team(ValidateJoin { team_name: "", game_code: "" })
```