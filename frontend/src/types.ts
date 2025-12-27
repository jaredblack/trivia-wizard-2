// === Question Kind (discriminant only) ===

export type QuestionKind = "standard" | "multiAnswer" | "multipleChoice";

export const questionKindLabels: Record<QuestionKind, string> = {
  standard: "Standard",
  multiAnswer: "Multi-Answer",
  multipleChoice: "Multiple Choice",
};

// === Score Types ===

export interface ScoreData {
  questionPoints: number;
  bonusPoints: number;
  overridePoints: number;
}

export function getScore(score: ScoreData): number {
  return score.questionPoints + score.bonusPoints + score.overridePoints;
}

// === Answer Types ===
// An Answer represents a single team's submission for a question.
// Answers are stored in order of submission (first to last).

export interface Answer {
  teamName: string;
  score: ScoreData | null;
  content: AnswerContent;
}

// The content of a team's answer, varying by question type.
export interface StandardAnswerContent {
  type: "standard";
  answerText: string;
}

export interface MultiAnswerAnswerContent {
  type: "multiAnswer";
  answers: string[];
}

export interface MultipleChoiceAnswerContent {
  type: "multipleChoice";
  selected: string;
}

export type AnswerContent =
  | StandardAnswerContent
  | MultiAnswerAnswerContent
  | MultipleChoiceAnswerContent;

// === Question ===

export interface Question {
  timerDuration: number;
  questionPoints: number;
  bonusIncrement: number;
  questionKind: QuestionKind;
  answers: Answer[];
}

// === Game Settings ===

export interface GameSettings {
  defaultTimerDuration: number;
  defaultQuestionPoints: number;
  defaultBonusIncrement: number;
  defaultQuestionType: QuestionKind;
}

// === Team Types ===

export interface TeamColor {
  hexCode: string;
  name: string;
}

export interface TeamData {
  teamName: string;
  teamMembers: string[];
  teamColor: TeamColor;
  score: ScoreData;
  connected: boolean;
}

// === Team Question (filtered view for team clients) ===
// Contains only the team's own answer and score for a question.

export interface TeamQuestion {
  score: ScoreData | null;
  answer: AnswerContent | null;
}

// === GameState (Server → Host) ===

export interface GameState {
  gameCode: string;
  currentQuestionNumber: number;
  timerRunning: boolean;
  timerSecondsRemaining: number | null;
  teams: TeamData[];
  questions: Question[];
  gameSettings: GameSettings;
}

// === TeamGameState (Server → Team) ===

export interface TeamGameState {
  gameCode: string;
  currentQuestionNumber: number;
  timerRunning: boolean;
  timerSecondsRemaining: number | null;
  team: TeamData;
  questions: TeamQuestion[];
}

// === Server Messages (tagged union with "type" discriminator) ===

export interface GameStateMessage {
  type: "gameState";
  state: GameState;
}

export interface TeamGameStateMessage {
  type: "teamGameState";
  state: TeamGameState;
}

export interface TimerTickMessage {
  type: "timerTick";
  secondsRemaining: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
  state?: GameState;
}

export type ServerMessage =
  | GameStateMessage
  | TeamGameStateMessage
  | TimerTickMessage
  | ErrorMessage;

// === Client Messages ===

export interface CreateGameAction {
  type: "createGame";
  gameCode?: string;
}

export interface StartTimerAction {
  type: "startTimer";
}

export interface PauseTimerAction {
  type: "pauseTimer";
}

export interface ResetTimerAction {
  type: "resetTimer";
}

export interface NextQuestionAction {
  type: "nextQuestion";
}

export interface PrevQuestionAction {
  type: "prevQuestion";
}

export interface ScoreAnswerAction {
  type: "scoreAnswer";
  questionNumber: number;
  teamName: string;
  score: ScoreData;
}

export interface OverrideTeamScoreAction {
  type: "overrideTeamScore";
  teamName: string;
  overridePoints: number;
}

export interface UpdateGameSettingsAction {
  type: "updateGameSettings";
  defaultTimerDuration: number;
  defaultQuestionPoints: number;
  defaultBonusIncrement: number;
  defaultQuestionType: QuestionKind;
}

export interface UpdateQuestionSettingsAction {
  type: "updateQuestionSettings";
  questionNumber: number;
  timerDuration: number;
  questionPoints: number;
  bonusIncrement: number;
  questionType: QuestionKind;
}

export type HostAction =
  | CreateGameAction
  | StartTimerAction
  | PauseTimerAction
  | ResetTimerAction
  | NextQuestionAction
  | PrevQuestionAction
  | ScoreAnswerAction
  | OverrideTeamScoreAction
  | UpdateGameSettingsAction
  | UpdateQuestionSettingsAction;

// Team actions use externally tagged enum format (variant name as key)
export interface JoinGameData {
  teamName: string;
  gameCode: string;
  colorHex: string;
  colorName: string;
  teamMembers: string[];
}

export interface SubmitAnswerData {
  teamName: string;
  answer: string;
}

export type TeamAction =
  | { joinGame: JoinGameData }
  | { submitAnswer: SubmitAnswerData };

export interface HostClientMessage {
  host: HostAction;
}

export interface TeamClientMessage {
  team: TeamAction;
}

export type ClientMessage = HostClientMessage | TeamClientMessage;
