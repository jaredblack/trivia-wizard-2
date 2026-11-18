// From a compiled deck to what the game server needs: one preset per question.
// A preset carries only what the deck actually declares; everything else is
// left to the game's defaults.

import type {
  McOptionType,
  NumericScoringMode,
  QuestionKind,
  QuestionPreset,
  RangeScoringType,
} from "../types";
import { correctOptionLabel, matchChoice } from "./choices";
import { parseNumericAnswer } from "./compile";

export { correctOptionLabel };
import { parseWithin, type Kind } from "./settings";
import type { CompiledDeck, DeckQuestion, ResolvedSetting } from "./types";

export const GAME_KIND: Record<Kind, QuestionKind> = {
  standard: "standard",
  "multi-answer": "multiAnswer",
  "multiple-choice": "multipleChoice",
  numeric: "numeric",
  map: "map",
};

const OPTION_TYPE: Record<string, McOptionType> = {
  letters: "letters",
  numbers: "numbers",
  "yes-no": "yesNo",
  "true-false": "trueFalse",
};

const SCORING_MODE: Record<string, NumericScoringMode> = {
  exact: "exactOnly",
  range: "range",
  closest: "closestGuess",
};

const declared = (r: ResolvedSetting) => r.source !== "builtin";

/** The answer as the host should read it while scoring. */
export function answerForHost(q: DeckQuestion): string {
  if (q.kind === "map" && q.location) return `${q.location[0]}, ${q.location[1]}`;
  if (q.answer === undefined) return "";
  if (Array.isArray(q.answer)) return q.answer.join(", ");
  if (q.kind === "multiple-choice") {
    const label = correctOptionLabel(q);
    const optionType = String(q.settings.options.value);
    if (label && q.choices && optionType !== "yes-no" && optionType !== "true-false") {
      const idx = matchChoice(q.answer, q.choices, optionType);
      if (idx !== -1) return `${label}. ${q.choices[idx]}`;
    }
    if (label) return label;
  }
  return String(q.answer);
}

export function buildPreset(q: DeckQuestion): QuestionPreset {
  const s = q.settings;
  const p: QuestionPreset = {};

  if (declared(s.timer)) p.timerDuration = Number(s.timer.value);
  if (declared(s.points)) p.questionPoints = Number(s.points.value);
  if (declared(s.bonus)) p.bonusIncrement = Number(s.bonus.value);
  if (declared(s["speed-bonus"])) p.speedBonusEnabled = Boolean(s["speed-bonus"].value);
  if (declared(s.kind)) p.kind = GAME_KIND[q.kind];

  switch (q.kind) {
    case "multi-answer":
      if (declared(s["num-answers"])) p.numAnswers = Number(s["num-answers"].value);
      break;
    case "multiple-choice":
      if (declared(s.options)) p.optionType = OPTION_TYPE[String(s.options.value)];
      if (declared(s["num-options"])) p.numOptions = Number(s["num-options"].value);
      break;
    case "numeric":
      if (declared(s.scoring)) p.scoringMode = SCORING_MODE[String(s.scoring.value)];
      if (declared(s.within)) {
        const within = parseWithin(s.within.value);
        p.rangeType = within.type;
        p.rangeValue = within.value;
      }
      if (declared(s.winners)) p.numWinners = Number(s.winners.value);
      if (declared(s["range-scoring"])) {
        p.rangeScoringType = String(s["range-scoring"].value) as RangeScoringType;
      }
      break;
    case "map":
      if (declared(s["full-points-km"])) {
        p.fullPointsDistanceKm = Number(s["full-points-km"].value);
      }
      if (declared(s["one-point-km"])) p.onePointDistanceKm = Number(s["one-point-km"].value);
      break;
    case "standard":
      break;
  }

  // Answer keys. The server uses only the one that fits the question's kind,
  // so a numeric reading is sent whenever the answer has one.
  const a = q.answer;
  if (q.kind === "multiple-choice") {
    const label = correctOptionLabel(q);
    if (label) p.answerKey = [label];
  } else if (Array.isArray(a)) {
    if (q.kind === "multi-answer") p.multiAnswerCorrectSet = a.map(String);
  } else if (a !== undefined) {
    if (q.kind === "multi-answer") p.multiAnswerCorrectSet = [String(a)];
    else p.answerKey = [String(a)];
    const n = parseNumericAnswer(a);
    if (n !== null) p.numericCorrectAnswer = n;
  }
  if (q.location) p.mapCorrectLocation = q.location;

  return p;
}

export function buildPresets(deck: CompiledDeck): QuestionPreset[] {
  return deck.questions.map(buildPreset);
}
