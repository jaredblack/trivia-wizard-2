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

// === Team Response Types ===
// Note: responses are stored as arrays to preserve submission order (first to last)

export interface TeamResponse {
  teamName: string;
  answerText: string;
  score: ScoreData;
}

export interface MultiAnswerResponse {
  teamName: string;
  answers: string[];
  scores: Record<string, ScoreData>;
}

// === Question Data (discriminated union) ===

export interface StandardQuestionData {
  type: "standard";
  responses: TeamResponse[];
}

export interface MultiAnswerQuestionData {
  type: "multiAnswer";
  responses: MultiAnswerResponse[];
}

export interface MultipleChoiceQuestionData {
  type: "multipleChoice";
  choices: string[];
  responses: TeamResponse[];
}

export type QuestionData =
  | StandardQuestionData
  | MultiAnswerQuestionData
  | MultipleChoiceQuestionData;

// === Question ===

export interface Question {
  timerDuration: number;
  questionPoints: number;
  bonusIncrement: number;
  questionData: QuestionData;
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
  currentQuestionKind: QuestionKind;
  currentQuestionChoices?: string[];
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

export interface JoinGameAction {
  type: "joinGame";
  teamName: string;
  gameCode: string;
  colorHex: string;
  colorName: string;
  teamMembers: string[];
}

export interface SubmitAnswerAction {
  type: "submitAnswer";
  teamName: string;
  answer: string;
}

export type TeamAction = JoinGameAction | SubmitAnswerAction;

export interface HostClientMessage {
  host: HostAction;
}

export interface TeamClientMessage {
  team: TeamAction;
}

export type ClientMessage = HostClientMessage | TeamClientMessage;
