// The deck as a sequence of steps the host walks through on game night: one
// per slide, plus a "revealed" step for slides that have an answer to show.
// Pure functions; the scoring view owns the side effects.

import type { CompiledDeck, DeckSlide } from "./types";

export interface Cursor {
  /** Index into `CompiledDeck.slides`; the generated title slide is 0. */
  slideIndex: number;
  revealed: boolean;
}

const hasReveal = (slide: DeckSlide | undefined) =>
  slide?.type === "question" && slide.hasReveal;

/** Bring a cursor back inside the deck (e.g. after a reload removed slides). */
export function clampCursor(deck: CompiledDeck, cursor: Cursor): Cursor {
  const slideIndex = Math.min(Math.max(cursor.slideIndex, 0), deck.slides.length - 1);
  return {
    slideIndex,
    revealed: cursor.revealed && hasReveal(deck.slides[slideIndex]) && slideIndex === cursor.slideIndex,
  };
}

export function nextCursor(deck: CompiledDeck, cursor: Cursor): Cursor | null {
  const at = clampCursor(deck, cursor);
  if (!at.revealed && hasReveal(deck.slides[at.slideIndex])) {
    return { slideIndex: at.slideIndex, revealed: true };
  }
  if (at.slideIndex + 1 >= deck.slides.length) return null;
  return { slideIndex: at.slideIndex + 1, revealed: false };
}

export function prevCursor(deck: CompiledDeck, cursor: Cursor): Cursor | null {
  const at = clampCursor(deck, cursor);
  if (at.revealed) return { slideIndex: at.slideIndex, revealed: false };
  if (at.slideIndex === 0) return null;
  const slideIndex = at.slideIndex - 1;
  // Going back lands on the previous slide as it was left: answer showing.
  return { slideIndex, revealed: hasReveal(deck.slides[slideIndex]) };
}

/**
 * The game question a slide belongs to: its own for a question slide, otherwise
 * the last question before it. Slides before the first question count as
 * question 1, since a game always has one open.
 */
export function questionAt(deck: CompiledDeck, slideIndex: number): number {
  for (let i = Math.min(slideIndex, deck.slides.length - 1); i >= 0; i--) {
    const s = deck.slides[i];
    if (s.type === "question") return s.questionNumber;
  }
  return 1;
}

/** The slide that opens question `n`, or null when the deck has no such question. */
export function mainSlideOf(deck: CompiledDeck, n: number): number | null {
  const q = deck.questions[n - 1];
  return q ? q.slideIndexes[0] : null;
}

/** Short name for a slide, for buttons and status text. */
export function slideLabel(deck: CompiledDeck, slideIndex: number): string {
  const slide = deck.slides[slideIndex];
  if (!slide) return "";
  switch (slide.type) {
    case "title":
      return "Title";
    case "join":
      return "Join slide";
    case "category":
      return `Category: ${slide.title}`;
    case "question": {
      const slides = deck.questions[slide.questionNumber - 1].slideIndexes;
      const part = slides.indexOf(slideIndex);
      return slides.length > 1
        ? `Q${slide.questionNumber} (${part + 1}/${slides.length})`
        : `Q${slide.questionNumber}`;
    }
    case "image":
      return slide.title ? `Image: ${slide.title.split("\n")[0]}` : "Image";
    case "custom":
      return "Custom slide";
  }
}

/** What the game looks like right now, as far as the next step is concerned. */
export interface GameMoment {
  currentQuestionNumber: number;
  timerRunning: boolean;
  timerSecondsRemaining: number | null;
  /** The current question's full timer length. */
  timerDuration: number;
  /** How many teams have answered the current question. */
  answers: number;
}

export type PrimaryAction =
  | { kind: "start-timer"; label: string }
  | { kind: "reveal"; label: string }
  | { kind: "next"; label: string; to: Cursor }
  | { kind: "end"; label: string };

/**
 * The one thing the host most likely wants to do next. On a question slide
 * that is: start the timer, then reveal the answer, then move on.
 */
export function primaryAction(
  deck: CompiledDeck,
  cursor: Cursor,
  game: GameMoment
): PrimaryAction {
  const at = clampCursor(deck, cursor);
  const slide = deck.slides[at.slideIndex];

  if (slide.type === "question" && !at.revealed) {
    const untouched =
      slide.questionNumber === game.currentQuestionNumber &&
      !game.timerRunning &&
      game.answers === 0 &&
      (game.timerSecondsRemaining === null ||
        game.timerSecondsRemaining === game.timerDuration);
    if (untouched) return { kind: "start-timer", label: "Start timer" };
    if (slide.hasReveal) return { kind: "reveal", label: "Reveal answer" };
  }

  const to = nextCursor(deck, at);
  if (!to) return { kind: "end", label: "End of deck" };
  const target = deck.slides[to.slideIndex];
  const label =
    target.type === "question" && target.part === "main"
      ? `Show Q${target.questionNumber}`
      : `Next: ${slideLabel(deck, to.slideIndex)}`;
  return { kind: "next", label, to };
}
