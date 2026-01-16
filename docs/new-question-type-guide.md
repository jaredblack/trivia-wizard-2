# Implementing a New Question Type

This guide covers what needs to be modified to add a new question type to the trivia app.

## Overview

Question types define how teams can answer questions. The architecture supports different:
- **Answer input UI** (team side) - how teams enter their answer
- **Main area UI** (host side) - controls and answer display above the answer list
- **Answer content format** - how answers are stored and transmitted
- **Question configuration** - per-question settings specific to the type

## Files to Modify

### Backend (Rust)

#### 1. `backend/src/model/types.rs`

**Add QuestionConfig variant** (if the type has configuration):
```rust
pub enum QuestionConfig {
    Standard,
    MultiAnswer,
    MultipleChoice { config: McConfig },
    YourNewType { config: YourConfig },  // Add here
}
```

**Add AnswerContent variant** (if answer format differs from existing types):
```rust
pub enum AnswerContent {
    Standard { answer_text: String },
    MultiAnswer { answers: Vec<String> },
    MultipleChoice { selected: String },
    YourNewType { /* your fields */ },  // Add here
}
```

#### 2. `backend/src/model/game.rs`

**Update `add_answer()`** to handle the new content type:
```rust
let content = match question.question_kind {
    QuestionKind::Standard => AnswerContent::Standard { answer_text },
    QuestionKind::MultipleChoice => AnswerContent::MultipleChoice { selected: answer_text },
    QuestionKind::YourNewType => AnswerContent::YourNewType { /* ... */ },
    // ...
};
```

**Update `create_question_from_settings()`** if the type has config:
```rust
let question_config = match self.game_settings.default_question_type {
    QuestionKind::YourNewType => QuestionConfig::YourNewType {
        config: self.game_settings.default_your_config.clone(),
    },
    // ...
};
```

### Frontend (TypeScript/React)

#### 3. `frontend/src/types.ts`

**Mirror backend changes:**
- Add `YourNewTypeQuestionConfig` interface
- Add to `QuestionConfig` union type
- Add `YourNewTypeAnswerContent` interface (if needed)
- Add to `AnswerContent` union type
- Update `answerToString()` to handle new content type

#### 4. Host UI Components

**Create `frontend/src/features/host/components/YourNewTypeMainArea.tsx`:**
- Contains any controls specific to this question type
- Renders `AnswerList` for displaying submitted answers
- Props: `question`, `questionNumber`, `teams`, `onScoreAnswer`, plus any config-related props

**Update `frontend/src/features/host/HostGame.tsx`:**
- Import the new main area component
- Add condition in the main content area to render it:
```tsx
{currentQuestion.questionKind === "yourNewType" ? (
  <YourNewTypeMainArea ... />
) : currentQuestion.questionKind === "multipleChoice" ? (
  <MultipleChoiceMainArea ... />
) : (
  <StandardMainArea ... />
)}
```

#### 5. Team UI Components

**Create `frontend/src/features/team/components/YourNewTypeAnswerInput.tsx`:**
- The UI teams use to input their answer
- Props: `draftAnswer`, `onDraftChange` (or equivalent), `onSubmit`, `teamColor`
- Must call `onSubmit` when team submits, which sends the answer string to the server

**Update `frontend/src/features/team/components/TeamGameView.tsx`:**
- Import the new input component
- Add condition in `renderContent()` View B section:
```tsx
if (questionKind === "yourNewType" && questionConfig?.type === "yourNewType") {
  return (
    <YourNewTypeAnswerInput
      // ... props
      onSubmit={handleSubmitAnswer}
      teamColor={team.teamColor.hexCode}
    />
  );
}
```

#### 6. `frontend/src/features/host/components/AnswerList.tsx`

The `answerToString()` helper already handles displaying answers. If your type uses `AnswerContent`, just ensure `answerToString()` in `types.ts` handles it.

## Data Flow

1. **Host selects question type** → `updateQuestionSettings` message sent
2. **Server updates `Question.questionKind` and `Question.questionConfig`**
3. **Server broadcasts to teams** → `TeamQuestion` includes `questionKind` and `questionConfig`
4. **Team sees appropriate input UI** based on `questionKind`
5. **Team submits answer** → plain string sent via `submitAnswer` message
6. **Server interprets string** based on `question.question_kind` → creates `AnswerContent`
7. **Host receives answer** displayed via `AnswerList` using `answerToString()`

## Key Patterns

- **Answer submission is always a string** - the server interprets it based on question type
- **QuestionConfig travels with TeamQuestion** - teams have all info needed to render UI
- **Component switching** - both host and team switch components based on `questionKind`
- **answerToString()** - centralizes answer display logic for all types

## Testing

After implementation:
1. Build backend: `cd backend && cargo build`
2. Build frontend: `cd frontend && npm run build`
3. Run backend tests: `cd backend && cargo test`
4. Run frontend lint: `cd frontend && npm run lint`
5. Manual test: create game, change question type, have team submit answer
