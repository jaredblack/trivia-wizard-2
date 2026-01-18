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
- Multiple choice question type
- At least one other question type, possibly based on the questions that I write for this trivia night (probably multi-answer)

## ideally also
- auto-score identical answers
   - game settings toggle for if it should do this at all, and if it should match bonus points or just base points
- automatically applied speed bonuses

# future playwright test cases
- auto-submit

## misc
- update verification email
- set an alarm on log::error from my app?
- game db lifecycle - I've never actually gone back to look at old trivia games since they're not that interesting. maybe they shouldn't really be persisted for that long? I think no DB at all, while removing a dependency which would be nice, would just be asking for trouble. The way things are going now, we'll start with no persistence and then figure out what the best way to do it is. Writing to a DB with every operation like I did for TW1 feels unnecessary when the server can track the state that realistically only needs to be temporary. One halfway option could be just serializing the whole game state every once in a while and writing it to S3 or a document DB? 
   - I need to be able to have old games for Amy's usecase
- submissions should auto-close when all answers have been received
- Also need to validate that user id matches when reclaiming a game
- Add a PartialJoin (need a better name) API for the frontend to call after you put in a game code/team name to verify that (a) game code is valid and (b) team name is available
- favicon
- should probably chill with the console.logs especially in websocket.ts


## beta
- need a ranking question type
- it's showing nick as disconnected but he can stil submit

## concerns
- The big game state Mutex<HashMap> gets touched _a lot_. We're not doing anything expensive while holding the lock (I think), but intuitively it feels like there could be contention which could lead to issues in when messages get processed, timer updates going out on time, etc. I think for now we continue down this path but if things look problematic in testing, we might have to consider a radically different architecture.
   - Likely that it will be fine for 1-2 games happening at the same time, but more than that... there may be some contention. Would be interesting to benchmark somehow. Hopefully it will never matter
   - There's probably a way to have the lock only be per-game instead of per-games. A fixed array of games maybe? Would be interesting to look into


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host


prompt

One clarification: when I say "first place" in this context I mean "first to answer this given question correctly", where "answering the question correctly" is defined as getting *any* question_points for the given question. And same for second place, third place, etc.

One scoring feature I would like to add is to allow speed bonuses to be applied to correct answers that are  
  submitted first. The way I envision this feature working is that, for a given question, whichever team answers   
  first with the correct answer gets some number of bonus points. A few aspects of this will be configurable, on a per-game level:    
   1. How many teams can get speed bonuses (should only 1st to answer correctly get a bonus? first three?)
   2. The number of bonus points that the first place team should get
Additionally, whether the bonus should be applied to a given question may also be applied at the per-question level (default OFF for the whole game and per question)

IMPORTANT NOTE: Scores for each question are represented as a ScoreData, which has three fields: question_points, bonus_points, and override_points. Speed bonuses will be applied in the override_points field, NOT the bonus_points field. The bonus points field is used for something else.

In order to add this feature, we will have to make some changes in key places:

Frontend:
- SettingsModal.tsx - add:
   - A "Speed Bonus" header
   - A switch which enables whether speed bonuses should be applied to all subsequent questions
   - A numeric input which determines how many teams can get speed bonuses (N)
   - A numeric input which determines the number of bonus points that the first place team should get
   - Text below these inputs which displays how many points each of the N teams will get on a given question for speed bonuses (see below: Calculating the bonus)
- PerQuestionSettings.tsx - add a switch that toggles whether speed bonuses should be applied for this question. Number of teams and points for the speed bonus are not configurable here.
- AnswerCard.tsx - Add a small indication of how many speed bonus points the team got (if any) on the answer card. Practically this will mean displaying how many override_points the team got.

Backend:
- game.rs: In the method score_answer, we will want to recalculate what the speed bonuses are and how they should be distributed. question.answers will be ordered from earliest answer to latest answer, so if speed bonuses have been enabled, we should apply the speed bonuses to whichever teams have been scored correct in submission order. Example:
   - Speed bonus: enabled. Number of teams that can get bonus: 2. Bonus distribution: 1st place: 10, 2nd place: 5
   - The following answers exist:
      - Team A: Apple
      - Team B: Apple
      - Team C: Apple
      - Team D: Giraffe
   - Host scores Team B correct. Due to auto-scoring, teams A and C also get points. Now the bonuses are like this:
      - Team A: Apple - question_points: 50, override_points: 10
      - Team B: Apple - question_points: 50,  override_points: 5
      - Team C: Apple - question_points: 50,  override_points: 0
      - Team C: Giraffe question_points: 0,  - override_points: 0
   - Now let's say the answers are a bit different:
      - Team A: Pear
      - Team B: Apple
      - Team C: Apple
      - Team D: Giraffe
   - And again, the host scores team B correct. Team C gets points automatically, and bonuses are distributed like such:
      - Team A: Pear - question_points: 0,  override_points: 0
      - Team B: Apple - question_points: 50, override_points: 10
      - Team C: Apple -  question_points: 50, override_points: 5
      - Team C: Giraffe - question_points: 0,  override_points: 0
   - But wait! Then the host actually realizes that "Pear" should be a valid answer to this question. Now the speed bonuses will reshuffle:
      - Team A: Pear - question_points: 50,  override_points: 10
      - Team B: Apple - question_points: 50, override_points: 5
      - Team C: Apple -  question_points: 50, override_points: 0
      - Team C: Giraffe - question_points: 0,  override_points: 0
- Add settings to update_game_settings and update_question_settings in game.rs as well
   - Note: Follow all existing logic for setting the whole-game settings about which questions it applies to, i.e. settings updates to the game are never retroactively applied on previously-scored questions

Calculating the bonus:
As I said before, only the number of points that the first place team gets can be set by the host. The number of bonus points given to the 2nd place...Nth place teams will be calculated by evenly dividing (N-1) intervals between the number of points that first place gets and 0, rounding down for each interval. For example:
If there are 3 teams and first place gets 10 points - 
   1st: 10
   2nd: 6 (10*2/3 = 6.67 rounded down)     
   3rd: 3 (10*1/3 = 3.33 rounded down)

If there are 2 teams and first place gets 5 points - 
   1st: 5
   2nd: 2 (5*1/2 = 2.5 rounded down)

If there are 5 teams and first place gets 10 points - 
   10
   8 (10*4/5 = 8)
   6
   4
   2

Please read the relevant places in code I mentioned to get a deeper understanding of what needs to be implemented. Then, ask me clarifying questions about the feature or the implementation. Then, make an implementation plan.


The override_points mechanism is currently only used for manual host adjustments at the overall score level, not on an individual question level. I think we can   
  add them into recalculate_team_score safely. Do you think so? The only place I can think of where this could cause issues is with the views that break down the    
  score to the user, for exmaple in the Scoreboard on hover where you can see Questions: x, Bonus: y, Overrides: z, and a similar view in ScoreLogDrawer. I think    
  the right way to handle this is to add an extra field here called "Speed Bonus" that calculates the aggregate of all the override_points from all the questions,   
  while the Overrides display remains the override on the team's total ScoreData. Does that make sense? I could also be convinced to add another field to ScoreData  
  if that works out cleaner.      

Upon further reflection, I'm realizing that it might be cleaner to simply add a new field to ScoreData: speed_bonus_points. override_points is unused on a per-question level, but we can leave it that way. The reason is, when we're aggregating up the total team ScoreData, we want it to be that each field in that ScoreData is equal to the sum of the per-question values (other than override_points which is only ever set on the total team ScoreData). So now we add a speed_bonus_points field to ScoreData. Then with the views that break down the score to the user, for exmaple in the Scoreboard on hover where you can see Questions: x, Bonus: y, Overrides: z, and a similar view in ScoreLogDrawer, add an extra field here called "Speed Bonus" that calculates the aggregate of all of those speed_bonus_points across all questions. 