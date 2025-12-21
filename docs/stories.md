We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.
## near future
- Need strongly typed frontend model classes. Lots of gotchas especially for the LLM around the serde rename traits

# Creating the Server running landing page
- To avoid HostLanding.tsx getting too big, I think once the host has joined a game, we should navigate to `/host/gametime` and have a GameView.tsx file
GameCreated:
      currentQuestionNumber: u32
      gameCode: String
      gameSettings: GameSettings
      currentQuestion: Question
      teams: TeamData[]

  GameSettings:
      defaultTimerDuration: u32
      defaultQuestionPoints: u32
      defaultBonusIncrement: u32
      defaultQuestionType: QuestionKind

  QuestionKind: enum (no data)
      Standard
      MultiAnswer
      MultipleChoice

  Question:
      timerDuration: u32
      questionPoints: u32
      bonusIncrement: u32
      questionData: QuestionData

  QuestionData: enum (with data)
      Standard:
          responses: Map<String, TeamResponse>
      MultiAnswer:
          responses: Map<String, MultiAnswerResponse>
      MultipleChoice:
          choices: String[]
          responses: Map<String, TeamResponse>

  TeamResponse:
      answerText: String
      score: ScoreData

  MultiAnswerResponse:
      answers: String[]
      scores: Map<String, ScoreData>

  TeamData:
      teamName: String
      teamMembers: String[]
      teamColor: TeamColor
      score: ScoreData
      connected: bool

  ScoreData:
      questionPoints: i32
      bonusPoints: i32
      overridePoints: i32
      method getScore() -> i32

  TeamColor:
      hexCode: String
      name: String
To start, we will hardcode all of these values on the serverside to create a well-populated host view.

First, we need to create the types in both the frontend and backend and make sure those types are compatible.

I wrote the above types in pseudocode that's closer to Rust's type system, but they should be fairly portable to TypeScript. 

One question I have: I like using a Rust enum that can have data associated with each variant for the QuestionType, then the data required for each question type is enumerated alongside the QuestionType itself. However, I'm not going to always have question data when passing along a QuestionType, for example in the defaultQuestionType in the GameSettings struct. What's a good way to handle this? The data inside could be Optional? I don't love that. Or maybe we could have a QuestionType type that's just purely the enumeration of the types and a separate QuestionData enum that has the same variants, just with data? Also doesn't seem great. Any other ideas?

Once we've discussed my questions and you've asked me any clarifying questions, I'd like you to start implementing these types in the Rust backend.



## misc
- update verification email
- set an alarm on log::error from my app?
- game db lifecycle - I've never actually gone back to look at old trivia games since they're not that interesting. maybe they shouldn't really be persisted
for that long? I think no DB at all, while removing a dependency which would be nice, would just be asking for trouble


## edge cases worth considering
- someone tries to create a game with the same code as another currently-connected host
