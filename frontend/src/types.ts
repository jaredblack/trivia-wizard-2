// === Question Kind (discriminant only) ===

export type QuestionKind = "standard" | "multiAnswer" | "multipleChoice";

export const questionKindLabels: Record<QuestionKind, string> = {
  standard: "Standard",
  multiAnswer: "Multi-Answer",
  multipleChoice: "Multiple Choice",
};

// === Multiple Choice Configuration ===

export type McOptionType =
  | "letters"
  | "numbers"
  | "yesNo"
  | "trueFalse"
  | "other";

export const mcOptionTypeLabels: Record<McOptionType, string> = {
  letters: "Letters",
  numbers: "Numbers",
  yesNo: "Yes / No",
  trueFalse: "True / False",
  other: "Other",
};

export interface McConfig {
  optionType: McOptionType;
  numOptions: number;
  customOptions?: string[];
}

export const defaultMcConfig: McConfig = {
  optionType: "letters",
  numOptions: 4,
};

// === Question Config (discriminated union by question kind) ===

export interface StandardQuestionConfig {
  type: "standard";
}

export interface MultiAnswerQuestionConfig {
  type: "multiAnswer";
}

export interface MultipleChoiceQuestionConfig {
  type: "multipleChoice";
  config: McConfig;
}

export type QuestionConfig =
  | StandardQuestionConfig
  | MultiAnswerQuestionConfig
  | MultipleChoiceQuestionConfig;

// Helper function to generate MC options based on config
export function getMcOptions(config: McConfig): string[] {
  const { optionType, numOptions } = config;

  switch (optionType) {
    case "letters":
    case "other": // "Other" defaults to letters initially
      return Array.from({ length: numOptions }, (_, i) =>
        String.fromCharCode(65 + i)
      );
    case "numbers":
      return Array.from({ length: numOptions }, (_, i) => String(i + 1));
    case "yesNo":
      return ["Yes", "No"];
    case "trueFalse":
      return ["True", "False"];
  }
}

// === Score Types ===

export interface ScoreData {
  questionPoints: number;
  bonusPoints: number;
  overridePoints: number;
  speedBonusPoints: number;
}

export function getScore(score: ScoreData): number {
  return score.questionPoints + score.bonusPoints + score.overridePoints + score.speedBonusPoints;
}

// === TeamQuestion ===
// Represents a team's state for a question, including their answer (if any) and score.
// - On the host side (Question.answers): only contains entries for teams that submitted.
// - On the team side (TeamGameState.questions): includes all historic questions,
//   so content may be null if the team didn't submit.

export interface TeamQuestion {
  teamName: string;
  score: ScoreData;
  content: AnswerContent | null;
  questionKind: QuestionKind;
  questionConfig: QuestionConfig;
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

export function answerToString(content: AnswerContent): string {
  switch (content.type) {
    case "standard":
      return content.answerText;
    case "multiAnswer":
      return content.answers.join(", ");
    case "multipleChoice":
      return content.selected;
  }
}

// === Question ===

export interface Question {
  timerDuration: number;
  questionPoints: number;
  bonusIncrement: number;
  questionKind: QuestionKind;
  questionConfig: QuestionConfig;
  answers: TeamQuestion[];
  speedBonusEnabled: boolean;
}

// === Game Settings ===

export interface GameSettings {
  defaultTimerDuration: number;
  defaultQuestionPoints: number;
  defaultBonusIncrement: number;
  defaultQuestionType: QuestionKind;
  defaultMcConfig: McConfig;
  speedBonusEnabled: boolean;
  speedBonusNumTeams: number;
  speedBonusFirstPlacePoints: number;
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

export interface JoinValidatedMessage {
  type: "joinValidated";
}

// === Scoreboard Data (for watchers) ===

export interface ScoreboardData {
  teams: TeamData[];
}

export interface ScoreboardDataMessage {
  type: "scoreboardData";
  data: ScoreboardData;
}

export type ServerMessage =
  | GameStateMessage
  | TeamGameStateMessage
  | TimerTickMessage
  | ErrorMessage
  | JoinValidatedMessage
  | ScoreboardDataMessage;

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
  defaultMcConfig: McConfig;
  speedBonusEnabled: boolean;
  speedBonusNumTeams: number;
  speedBonusFirstPlacePoints: number;
}

export interface UpdateQuestionSettingsAction {
  type: "updateQuestionSettings";
  questionNumber: number;
  timerDuration: number;
  questionPoints: number;
  bonusIncrement: number;
  questionType: QuestionKind;
  mcConfig?: McConfig;
  speedBonusEnabled: boolean;
}

export interface UpdateTypeSpecificSettingsAction {
  type: "updateTypeSpecificSettings";
  questionNumber: number;
  questionConfig: QuestionConfig;
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
  | UpdateQuestionSettingsAction
  | UpdateTypeSpecificSettingsAction;

// Team actions use externally tagged enum format (variant name as key)
export interface ValidateJoinData {
  teamName: string;
  gameCode: string;
}

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
  | { validateJoin: ValidateJoinData }
  | { joinGame: JoinGameData }
  | { submitAnswer: SubmitAnswerData };

export interface HostClientMessage {
  host: HostAction;
}

export interface TeamClientMessage {
  team: TeamAction;
}

// Watcher actions use externally tagged enum format
export interface WatchGameData {
  gameCode: string;
}

export type WatcherAction = { watchGame: WatchGameData };

export interface WatcherClientMessage {
  watcher: WatcherAction;
}

export type ClientMessage = HostClientMessage | TeamClientMessage | WatcherClientMessage;
