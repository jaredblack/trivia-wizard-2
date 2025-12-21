// === Question Kind (discriminant only) ===

export type QuestionKind = "standard" | "multiAnswer" | "multipleChoice";

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

export interface TeamResponse {
  answerText: string;
  score: ScoreData;
}

export interface MultiAnswerResponse {
  answers: string[];
  scores: Record<string, ScoreData>;
}

// === Question Data (discriminated union) ===

export interface StandardQuestionData {
  type: "standard";
  responses: Record<string, TeamResponse>;
}

export interface MultiAnswerQuestionData {
  type: "multiAnswer";
  responses: Record<string, MultiAnswerResponse>;
}

export interface MultipleChoiceQuestionData {
  type: "multipleChoice";
  choices: string[];
  responses: Record<string, TeamResponse>;
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

// === Server Messages ===

export interface GameCreated {
  currentQuestionNumber: number;
  gameCode: string;
  gameSettings: GameSettings;
  currentQuestion: Question;
  teams: TeamData[];
}

export interface NewAnswer {
  answer: string;
  teamName: string;
}

export interface ScoreUpdate {
  teamName: string;
  score: number;
}

export interface HostServerMessage {
  gameCreated?: GameCreated;
  newAnswer?: NewAnswer;
  scoreUpdate?: ScoreUpdate;
}

export interface TeamServerMessage {
  gameJoined?: { gameCode: string };
  answerSubmitted?: true;
}

export interface ServerMessage {
  host?: HostServerMessage;
  team?: TeamServerMessage;
  error?: string;
}
