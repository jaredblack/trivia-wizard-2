// Multiple-choice answers: which choice an answer names, and which option a
// team taps for it. Shared by the compiler (to warn when they don't line up),
// the game presets and the inspector.

import type { DeckQuestion } from "./types";

/** The options teams see on their phones, in order. */
export function optionLabels(optionType: string, numOptions: number): string[] {
  switch (optionType) {
    case "yes-no":
      return ["Yes", "No"];
    case "true-false":
      return ["True", "False"];
    case "numbers":
      return Array.from({ length: numOptions }, (_, i) => String(i + 1));
    default:
      return Array.from({ length: numOptions }, (_, i) => String.fromCharCode(65 + i));
  }
}

/**
 * The label shown beside each of `count` choices on the slide. Follows the
 * option labels when there is one for every choice, letters otherwise.
 */
export function choiceLabels(optionType: string, count: number): string[] {
  const labels = optionLabels(optionType, count);
  return labels.length >= count ? labels.slice(0, count) : optionLabels("letters", count);
}

/** "A–D", "1–4", "Yes or No": the options as a phrase, for messages. */
export function describeOptions(labels: string[]): string {
  if (labels.length === 2 && /^[A-Z][a-z]/.test(labels[0])) return `${labels[0]} or ${labels[1]}`;
  return labels.length > 1 ? `${labels[0]}–${labels[labels.length - 1]}` : (labels[0] ?? "");
}

/**
 * Which choice an answer names: its text (ignoring case), its letter, or its
 * number when the options are numbered. Returns the 0-based index, or -1 when
 * it names none of them.
 */
export function matchChoice(answer: unknown, choices: string[], optionType?: string): number {
  if (typeof answer !== "string" && typeof answer !== "number") return -1;
  const a = String(answer).trim().toLowerCase();
  const byText = choices.findIndex((c) => c.trim().toLowerCase() === a);
  if (byText !== -1) return byText;
  if (/^[a-z]$/.test(a)) {
    const idx = a.charCodeAt(0) - 97;
    if (idx < choices.length) return idx;
  }
  if (optionType === "numbers" && /^\d+$/.test(a)) {
    const idx = Number(a) - 1;
    if (idx >= 0 && idx < choices.length) return idx;
  }
  return -1;
}

/**
 * The option a team taps for the correct answer of a multiple-choice question,
 * or null when the answer doesn't name one of the options they are offered.
 */
export function correctOptionLabel(q: DeckQuestion): string | null {
  if (q.answer === undefined || Array.isArray(q.answer)) return null;
  const optionType = String(q.settings.options.value);
  const labels = optionLabels(optionType, Number(q.settings["num-options"].value));
  const asLabel = (text: string) =>
    labels.find((l) => l.toLowerCase() === text.trim().toLowerCase()) ?? null;

  if (optionType === "yes-no" || optionType === "true-false") {
    // The answer says it outright, or names a choice that does.
    const direct = asLabel(String(q.answer));
    if (direct || !q.choices) return direct;
    const idx = matchChoice(q.answer, q.choices, optionType);
    return idx === -1 ? null : asLabel(q.choices[idx]);
  }
  if (q.choices) {
    const idx = matchChoice(q.answer, q.choices, optionType);
    return idx === -1 || idx >= labels.length ? null : labels[idx];
  }
  return asLabel(String(q.answer));
}
