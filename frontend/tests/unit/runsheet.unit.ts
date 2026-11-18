// Unit tests for the game-night run sheet. Run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileDeck } from "../../src/deck/compile";
import {
  clampCursor,
  mainSlideOf,
  nextCursor,
  prevCursor,
  primaryAction,
  questionAt,
  slideLabel,
  type Cursor,
  type GameMoment,
} from "../../src/deck/runsheet";

// Slides: 0 title, 1 join, 2 category, 3 Q1, 4 Q2 (no answer), 5 Q2 follow-up,
// 6 image, 7 category, 8 Q3.
const deck = compileDeck(`title: T
slides:
- join
- category: Warm Up
- q: One
  a: Paris
- q: Two
- then: Two again
  a: Mars
- image: globe
  title: Take the survey
- category: Finale
- q: Three
  a: 3
`);

const at = (slideIndex: number, revealed = false): Cursor => ({ slideIndex, revealed });
const moment = (over: Partial<GameMoment> = {}): GameMoment => ({
  currentQuestionNumber: 1,
  timerRunning: false,
  timerSecondsRemaining: 30,
  timerDuration: 30,
  answers: 0,
  ...over,
});

test("steps forward through every slide, pausing on reveals", () => {
  const seen: string[] = [];
  let c: Cursor | null = at(0);
  while (c) {
    seen.push(`${c.slideIndex}${c.revealed ? "r" : ""}`);
    c = nextCursor(deck, c);
  }
  assert.deepEqual(seen, ["0", "1", "2", "3", "3r", "4", "5", "5r", "6", "7", "8", "8r"]);
});

test("steps back to slides as they were left", () => {
  const seen: string[] = [];
  let c: Cursor | null = at(8, true);
  while (c) {
    seen.push(`${c.slideIndex}${c.revealed ? "r" : ""}`);
    c = prevCursor(deck, c);
  }
  assert.deepEqual(seen, ["8r", "8", "7", "6", "5r", "5", "4", "3r", "3", "2", "1", "0"]);
});

test("each slide belongs to the last question at or before it", () => {
  assert.deepEqual(
    deck.slides.map((_, i) => questionAt(deck, i)),
    [1, 1, 1, 1, 2, 2, 2, 2, 3]
  );
  assert.equal(mainSlideOf(deck, 2), 4);
  assert.equal(mainSlideOf(deck, 3), 8);
  assert.equal(mainSlideOf(deck, 4), null);
});

test("labels name slides the way the host thinks of them", () => {
  assert.deepEqual(
    deck.slides.map((_, i) => slideLabel(deck, i)),
    ["Title", "Join slide", "Category: Warm Up", "Q1", "Q2 (1/2)", "Q2 (2/2)", "Image: Take the survey", "Category: Finale", "Q3"]
  );
});

test("primary action walks a question: show, start timer, reveal, next", () => {
  assert.deepEqual(primaryAction(deck, at(2), moment()), { kind: "next", label: "Show Q1", to: at(3) });
  assert.deepEqual(primaryAction(deck, at(3), moment()), { kind: "start-timer", label: "Start timer" });
  // Once the timer has been used, the answer is next.
  assert.equal(primaryAction(deck, at(3), moment({ timerRunning: true })).kind, "reveal");
  assert.equal(primaryAction(deck, at(3), moment({ timerSecondsRemaining: 12 })).kind, "reveal");
  assert.equal(primaryAction(deck, at(3), moment({ answers: 2, timerSecondsRemaining: 30 })).kind, "reveal");
  assert.deepEqual(primaryAction(deck, at(3, true), moment({ answers: 2 })), { kind: "next", label: "Show Q2", to: at(4) });
});

test("primary action handles follow-up slides, plain slides and the end", () => {
  const q2 = moment({ currentQuestionNumber: 2 });
  assert.equal(primaryAction(deck, at(4), q2).kind, "start-timer");
  // Slide 4 has nothing to reveal, so after the timer it moves to the follow-up.
  assert.deepEqual(primaryAction(deck, at(4), { ...q2, answers: 1 }), { kind: "next", label: "Next: Q2 (2/2)", to: at(5) });
  assert.equal(primaryAction(deck, at(5), { ...q2, answers: 1 }).kind, "reveal");
  assert.deepEqual(primaryAction(deck, at(5, true), q2), { kind: "next", label: "Next: Image: Take the survey", to: at(6) });
  assert.deepEqual(primaryAction(deck, at(6), q2), { kind: "next", label: "Next: Category: Finale", to: at(7) });
  assert.deepEqual(primaryAction(deck, at(8, true), moment({ currentQuestionNumber: 3 })), { kind: "end", label: "End of deck" });
  // A timer never offered for a question the game isn't on.
  assert.equal(primaryAction(deck, at(8), moment({ currentQuestionNumber: 2 })).kind, "reveal");
});

test("a cursor past the end of a shortened deck is pulled back in", () => {
  assert.deepEqual(clampCursor(deck, at(40, true)), at(8, false));
  assert.deepEqual(clampCursor(deck, at(3, true)), at(3, true));
  // "Revealed" on a slide with nothing to reveal is dropped.
  assert.deepEqual(clampCursor(deck, at(2, true)), at(2, false));
});
