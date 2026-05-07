// === Question Kind (discriminant only) ===

export type QuestionKind = "standard" | "multiAnswer" | "multipleChoice" | "numeric" | "map";

export const questionKindLabels: Record<QuestionKind, string> = {
  standard: "Standard",
  multiAnswer: "Multi-Answer",
  multipleChoice: "Multiple Choice",
  numeric: "Numeric",
  map: "Map",
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

// === Multi-Answer Configuration ===

export interface MultiAnswerConfig {
  numAnswers: number;
}

export const defaultMultiAnswerConfig: MultiAnswerConfig = {
  numAnswers: 3,
};

// === Numeric Configuration ===

export type NumericScoringMode = "exactOnly" | "range" | "closestGuess";

export type NumericRangeType = "absolute" | "percent";

export type RangeScoringType = "linear" | "flat";

export interface NumericConfig {
  scoringMode: NumericScoringMode;
  rangeType: NumericRangeType;
  rangeValue: number;
  numWinners: number;
  rangeScoringType: RangeScoringType;
}

export const defaultNumericConfig: NumericConfig = {
  scoringMode: "exactOnly",
  rangeType: "absolute",
  rangeValue: 5,
  numWinners: 3,
  rangeScoringType: "linear",
};

// === Map Configuration ===

export interface MapConfig {
  fullPointsDistanceKm: number;
  zeroPointsDistanceKm: number;
}

export const defaultMapConfig: MapConfig = {
  fullPointsDistanceKm: 0.025,
  zeroPointsDistanceKm: 20000,
};

// === Question Config (discriminated union by question kind) ===

export interface StandardQuestionConfig {
  type: "standard";
}

export interface MultiAnswerQuestionConfig {
  type: "multiAnswer";
  numAnswers: number;
}

export interface MultipleChoiceQuestionConfig {
  type: "multipleChoice";
  optionType: McOptionType;
  numOptions: number;
  customOptions?: string[];
}

export interface NumericQuestionConfig {
  type: "numeric";
  scoringMode: NumericScoringMode;
  rangeType: NumericRangeType;
  rangeValue: number;
  numWinners: number;
  rangeScoringType: RangeScoringType;
}

export interface MapQuestionConfig {
  type: "map";
  fullPointsDistanceKm: number;
  zeroPointsDistanceKm: number;
}

export type QuestionConfig =
  | StandardQuestionConfig
  | MultiAnswerQuestionConfig
  | MultipleChoiceQuestionConfig
  | NumericQuestionConfig
  | MapQuestionConfig;

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

// === Answer ===
// Lean struct used in Question.answers (host view). The parent Question already has
// questionConfig, so it is not repeated here.

export interface Answer {
  teamName: string;
  score: ScoreData;
  content: AnswerContent | null;
}

// === TeamQuestion ===
// Represents a team's per-question view (team side). Includes questionConfig because
// there is no parent Question in TeamGameState.questions.
// - content may be null if the team didn't submit.

export interface TeamQuestion {
  teamName: string;
  score: ScoreData;
  content: AnswerContent | null;
  questionConfig: QuestionConfig;
}

// The content of a team's answer, varying by answer shape (not question type).
// Single covers Standard and MultipleChoice questions (both hold one string).
// Multi covers MultiAnswer questions (array of strings with correctness flags).
export interface SingleAnswerContent {
  type: "single";
  answerText: string;
}

export interface MultiAnswerContent {
  type: "multi";
  answers: string[];
  correct: boolean[];
}

export interface CoordinatesAnswerContent {
  type: "coordinates";
  lat: number;
  lng: number;
}

export type AnswerContent = SingleAnswerContent | MultiAnswerContent | CoordinatesAnswerContent;

export function answerToString(content: AnswerContent): string {
  switch (content.type) {
    case "single":
      return content.answerText;
    case "multi":
      return content.answers.join(", ");
    case "coordinates":
      return `${content.lat.toFixed(4)}, ${content.lng.toFixed(4)}`;
  }
}

// === Question ===

export interface Question {
  timerDuration: number;
  questionPoints: number;
  bonusIncrement: number;
  questionConfig: QuestionConfig;
  answers: Answer[];
  speedBonusEnabled: boolean;
  multiAnswerCorrectSet?: string[];
  numericCorrectAnswer?: number | null;
  mapCorrectLocation?: [number, number] | null;
}

// === Game Settings ===

export interface GameSettings {
  defaultTimerDuration: number;
  defaultQuestionPoints: number;
  defaultBonusIncrement: number;
  defaultQuestionType: QuestionKind;
  defaultMcConfig: McConfig;
  defaultMultiAnswerConfig: MultiAnswerConfig;
  defaultNumericConfig: NumericConfig;
  defaultMapConfig: MapConfig;
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
  timerRunning: boolean;
  timerSecondsRemaining: number | null;
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
  uuid?: string;
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
  defaultMultiAnswerConfig: MultiAnswerConfig;
  defaultNumericConfig: NumericConfig;
  defaultMapConfig: MapConfig;
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

export interface ToggleMultiAnswerCorrectnessAction {
  type: "toggleMultiAnswerCorrectness";
  questionNumber: number;
  teamName: string;
  subAnswerIndex: number;
}

export interface SetNumericCorrectAnswerAction {
  type: "setNumericCorrectAnswer";
  questionNumber: number;
  correctAnswer: number | null;
}

export interface SetMapCorrectLocationAction {
  type: "setMapCorrectLocation";
  questionNumber: number;
  correctLocation: [number, number] | null;
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
  | UpdateTypeSpecificSettingsAction
  | ToggleMultiAnswerCorrectnessAction
  | SetNumericCorrectAnswerAction
  | SetMapCorrectLocationAction;

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
  answer: string | string[] | { lat: number; lng: number };
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
