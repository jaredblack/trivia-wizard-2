// Unit tests for the deck format. Run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileDeck, matchChoice, parseNumericAnswer, slideIndexAtLine } from "../../src/deck/compile";
import { convertLegacyDeck, isLegacyDeck } from "../../src/deck/legacy";
import { buildDeckSchema } from "../../src/deck/schema";
import { resolveImage } from "../../src/deck/images";
import { SETTINGS } from "../../src/deck/settings";
import type { QuestionSlide } from "../../src/deck/types";

const DECK = `title: Trivia Night!
subtitle: July 25, 2026
defaults:
  timer: 60
  points: 50
slides:
- join

- category: Date Your Meme
  subtitle: Half points for one year off.
  kind: numeric
  within: 1

- q: "'The Dress' went viral in which year?"
  a: 2015
  image: the-dress
  timer: 45
  # ask Grace for a better one

- q: Most popular vehicle in Massachusetts?
  a: Toyota Rav4
  kind: multiple-choice
  choices: [Toyota Rav4, Ford F-150, Honda CR-V]
  answer-image: [ma-sales, "https://example.com/x.png"]

- category: Rank 'em
  points: 100

- q: Rank the states by GDP
  choices: [Vermont, Utah]
  a:
  - Utah ($316B)
  - Vermont ($46B)

- q: Nie oceniłam pierwszego tomu
- then: I didn't rate the first volume
  a: New Moon

- image: cbm-1
  title: Take the survey
`;

test("compiles slides in order with a generated title slide", () => {
  const deck = compileDeck(DECK);
  assert.deepEqual(deck.problems, []);
  assert.equal(deck.legacy, false);
  assert.deepEqual(
    deck.slides.map((s) => s.type),
    ["title", "join", "category", "question", "question", "category", "question", "question", "question", "image"]
  );
  assert.equal(deck.title, "Trivia Night!");
  assert.equal(deck.subtitle, "July 25, 2026");
});

test("numbers questions by order and keeps follow-up slides on the same number", () => {
  const deck = compileDeck(DECK);
  assert.equal(deck.questions.length, 4);
  const slides = deck.slides.filter((s): s is QuestionSlide => s.type === "question");
  assert.deepEqual(slides.map((s) => s.questionNumber), [1, 2, 3, 4, 4]);
  assert.deepEqual(slides.map((s) => s.part), ["main", "main", "main", "main", "then"]);
  assert.equal(deck.questions[3].slideIndexes.length, 2);
  // The follow-up slide's answer becomes the question's answer.
  assert.equal(deck.questions[3].answer, "New Moon");
});

test("settings cascade: question over category over deck over built-in", () => {
  const deck = compileDeck(DECK);
  const dress = deck.questions[0].settings;
  assert.deepEqual(dress.timer, { value: 45, source: "question" });
  assert.deepEqual(dress.kind, { value: "numeric", source: "category" });
  assert.deepEqual(dress.within, { value: 1, source: "category" });
  assert.deepEqual(dress.points, { value: 50, source: "deck" });
  assert.deepEqual(dress.bonus, { value: 5, source: "builtin" });
  // `within` without `scoring` means range scoring, credited to the same level.
  assert.deepEqual(dress.scoring, { value: "range", source: "category" });

  const vehicle = deck.questions[1].settings;
  assert.deepEqual(vehicle.kind, { value: "multiple-choice", source: "question" });
  assert.deepEqual(vehicle.timer, { value: 60, source: "deck" });
  assert.deepEqual(vehicle["num-options"], { value: 3, source: "implied" });
});

test("a category's settings stop at the next category", () => {
  const deck = compileDeck(DECK);
  const rank = deck.questions[2];
  assert.deepEqual(rank.settings.points, { value: 100, source: "category" });
  assert.deepEqual(rank.settings.kind, { value: "standard", source: "builtin" });
  assert.deepEqual(deck.categories[0].questionNumbers, [1, 2]);
  assert.deepEqual(deck.categories[1].questionNumbers, [3, 4]);
});

test("choices imply multiple choice, except for a ranking with a list answer", () => {
  const deck = compileDeck(`title: t
slides:
- q: Pick one
  a: B
  choices: [x, y, z]
- q: Rank them
  a: [y, x]
  choices: [x, y]
`);
  assert.deepEqual(deck.questions[0].settings.kind, { value: "multiple-choice", source: "implied" });
  assert.equal(deck.questions[1].kind, "standard");
  const slides = deck.slides.filter((s): s is QuestionSlide => s.type === "question");
  assert.equal(slides[0].answerText, "B");
  assert.deepEqual(slides[1].answerList, ["y", "x"]);
  assert.equal(slides[1].answerText, undefined);
});

test("image keys say when the image appears", () => {
  const deck = compileDeck(DECK);
  const slides = deck.slides.filter((s): s is QuestionSlide => s.type === "question");
  assert.deepEqual(slides[0].images, ["the-dress"]);
  assert.deepEqual(slides[0].answerImages, []);
  assert.deepEqual(slides[1].answerImages, ["ma-sales", "https://example.com/x.png"]);
  assert.equal(slides[0].hasReveal, true);
  const refs = deck.images.map((i) => `${i.ref}:${i.when}`);
  assert.deepEqual(refs, [
    "the-dress:question",
    "ma-sales:answer",
    "https://example.com/x.png:answer",
    "cbm-1:question",
  ]);
  // Columns point at the name itself so the editor can decorate it.
  const dress = deck.images[0];
  const line = DECK.split("\n")[dress.line - 1];
  assert.equal(line.slice(dress.col - 1, dress.endCol - 1), "the-dress");
  const quoted = deck.images[2];
  const qline = DECK.split("\n")[quoted.line - 1];
  assert.equal(qline.slice(quoted.col - 1, quoted.endCol - 1), "https://example.com/x.png");
});

test("line ranges cover each item and its trailing comments", () => {
  const deck = compileDeck(DECK);
  const lines = DECK.split("\n");
  const dress = deck.questions[0].range;
  assert.match(lines[dress.startLine - 1], /^- q: "'The Dress'/);
  assert.match(lines[dress.contentEndLine - 1], /timer: 45/);
  assert.ok(dress.endLine >= dress.contentEndLine);
  // A cursor on the comment still belongs to that question.
  const commentLine = lines.findIndex((l) => l.includes("ask Grace")) + 1;
  const idx = slideIndexAtLine(deck, commentLine);
  assert.equal(deck.slides[idx].type, "question");
  assert.equal((deck.slides[idx] as QuestionSlide).questionNumber, 1);
  // Before the first slide there is nothing.
  assert.equal(slideIndexAtLine(deck, 1), -1);
});

test("block scalars keep their content end line inside the item", () => {
  const text = `title: t
slides:
- q: |
    line one

    line two
  a: yes

- q: next
  a: 1
`;
  const deck = compileDeck(text);
  assert.deepEqual(deck.problems, []);
  assert.equal(deck.questions[0].text, "line one\n\nline two\n");
  assert.equal(deck.questions[0].range.startLine, 3);
  assert.equal(deck.questions[0].range.contentEndLine, 7);
  assert.equal(deck.questions[1].range.startLine, 9);
});

test("problems are reported in plain words with a line", () => {
  const deck = compileDeck(`title: t
slides:
- then: orphan
- q: question text
  a: answer text
- q: No answer here
- q: Which?
  a: Nope
  choices: [x, y]
- q: How many?
  kind: numeric
  a: lots
- q: Where?
  kind: map
- q: Bad timer
  a: 1
  timer: soon
- nonsense
- wat: 1
`);
  const msgs = deck.problems.map((p) => p.message);
  assert.ok(msgs.some((m) => m.includes("no question above")));
  assert.ok(msgs.some((m) => m === "Question 1 still has placeholder text."));
  assert.ok(msgs.some((m) => m === "Question 2 has no answer."));
  assert.ok(msgs.some((m) => m.includes("Question 3's answer isn't one of its choices")));
  assert.ok(msgs.some((m) => m.includes("Question 4 is numeric but its answer isn't a number")));
  assert.ok(msgs.some((m) => m.includes("Question 5 is a map question with no `location`")));
  assert.ok(msgs.some((m) => m.includes("`timer` must be a whole number")));
  assert.ok(msgs.some((m) => m.includes("`nonsense` isn't a slide")));
  assert.ok(msgs.some((m) => m.includes("needs one of `q`")));
  assert.ok(deck.problems.every((p) => typeof p.line === "number"));
  // A bad value is ignored rather than applied.
  assert.deepEqual(deck.questions[5].settings.timer, { value: 30, source: "builtin" });
});

test("a syntax error is a problem, not a crash", () => {
  const deck = compileDeck("title: t\nslides:\n- q: [unclosed\n");
  assert.ok(deck.problems.some((p) => p.severity === "error"));
  const empty = compileDeck("");
  assert.equal(empty.slides.length, 1);
  assert.deepEqual(empty.problems, []);
});

test("map questions carry their location", () => {
  const deck = compileDeck(`title: t
slides:
- q: Where is the Bean?
  kind: map
  location: [41.8827, -87.6233]
`);
  assert.deepEqual(deck.problems, []);
  assert.deepEqual(deck.questions[0].location, [41.8827, -87.6233]);
});

test("answer helpers", () => {
  assert.equal(parseNumericAnswer(2015), 2015);
  assert.equal(parseNumericAnswer("2015"), 2015);
  assert.equal(parseNumericAnswer("$1,000"), 1000);
  assert.equal(parseNumericAnswer("12.5%"), 12.5);
  assert.equal(parseNumericAnswer("3:42.66"), null);
  assert.equal(parseNumericAnswer("lots"), null);
  assert.equal(matchChoice("ford f-150", ["Toyota Rav4", "Ford F-150"]), 1);
  assert.equal(matchChoice("B", ["x", "y", "z"]), 1);
  assert.equal(matchChoice("D", ["x", "y", "z"]), -1);
  assert.equal(matchChoice("nope", ["x", "y"]), -1);
});

const LEGACY = `title: Old
subtitle: 'July 25, 2026'
slides:
  - type: image
    title: |
      Join the game
      Game code: BAGK
    image: trivia-wizard-join-qr

  # planning note
  - type: category
    title: Pizza
    subtitle: Styles
  - type: question
    id: IDV
    question: Which style is this?
    answer: New Haven
    images:
      - url: https://example.com/pizza.jpg
        reveal: question
  - type: question
    id: ICU
    question: Most popular vehicle?
    answer: Toyota Rav4
    choices:
      - Toyota Rav4
      - Ford F-150
    images:
      - url: icu-1
        reveal: answer
  - type: question
    id: AAD
    question: What is this called?
    answer: Derailleur
    timerDuration: 45
    questionKind: multipleChoice
    config:
      numOptions: 5
      optionType: yesNo
    images:
      - url: ./aad-2
        position: center
  - type: question
    id: SFH
    question: Rank the states
    choices:
      - Vermont
      - Utah
  - type: question
    id: SFH
    question: Rank the states
    choices:
      - 1. Utah
      - 2. Vermont
  - type: image
    image: "cbm-1"
    title: Take the survey
  - type: question
    id: IDV
    question: Reused id
    answer: x
  - type: custom
    html: '<h1>Intermission</h1>'
`;

test("detects the old format", () => {
  assert.equal(isLegacyDeck(LEGACY), true);
  assert.equal(isLegacyDeck(DECK), false);
  // A question that merely mentions "type:" in its text is not legacy.
  assert.equal(isLegacyDeck("title: t\nslides:\n- q: 'type: what?'\n  a: x\n"), false);
});

test("converts the old format, keeping comments and quoting", () => {
  const out = convertLegacyDeck(LEGACY);
  assert.equal(isLegacyDeck(out), false);
  assert.match(out, /^- join$/m);
  assert.match(out, /^# planning note$/m);
  assert.match(out, /^- category: Pizza$/m);
  assert.match(out, /^- q: Which style is this\?$/m);
  assert.match(out, /^ {2}image: https:\/\/example\.com\/pizza\.jpg$/m);
  assert.match(out, /^ {2}answer-image: icu-1$/m);
  assert.match(out, /^ {2}timer: 45$/m);
  assert.match(out, /^ {2}kind: multiple-choice$/m);
  assert.match(out, /^ {2}num-options: 5$/m);
  assert.match(out, /^ {2}options: yes-no$/m);
  assert.match(out, /^ {2}image: aad-2$/m);
  assert.match(out, /^ {2}layout: hero$/m);
  assert.match(out, /^- then: Rank the states$/m);
  assert.match(out, /shared id SFH with the question above/);
  assert.match(out, /reused id IDV from an earlier question/);
  assert.match(out, /^- image: "cbm-1"$/m);
  assert.match(out, /^- html: '<h1>Intermission<\/h1>'$/m);
  assert.doesNotMatch(out, /^\s*(- )?(type|id):/m);
  // Nothing is indented under `slides:` any more.
  assert.match(out, /^slides:\n- join/m);

  const deck = compileDeck(out);
  assert.deepEqual(deck.problems.filter((p) => p.severity === "error"), []);
  assert.equal(deck.questions.length, 5);
});

test("an old-format deck compiles as-is and is flagged for conversion", () => {
  const deck = compileDeck(LEGACY);
  assert.equal(deck.legacy, true);
  assert.equal(deck.questions.length, 5);
  assert.equal(deck.slides[1].type, "join");
  const hero = deck.slides.find(
    (s): s is QuestionSlide => s.type === "question" && s.text === "What is this called?"
  );
  assert.equal(hero?.layout, "hero");
});

test("schema is generated from the settings table", () => {
  const schema = buildDeckSchema() as {
    properties: { defaults: { properties: Record<string, { description: string }> } };
    definitions: { question: { properties: Record<string, unknown> }; then: { properties: Record<string, unknown> } };
  };
  for (const def of SETTINGS) {
    assert.ok(schema.properties.defaults.properties[def.key], def.key);
    assert.ok(schema.definitions.question.properties[def.key], def.key);
    assert.equal(schema.definitions.then.properties[def.key], undefined);
  }
  assert.match(schema.properties.defaults.properties.timer.description, /Default: 30s\./);
});

test("image names resolve event-first, then shared", () => {
  const ctx = {
    cdnBase: "/cdn",
    eventBase: "/events/abc",
    sharedImages: ["bg.png", "Dress.jpg"],
    eventImages: ["dress.jpg", "img-7f3a.jpg"],
  };
  assert.deepEqual(resolveImage("dress", ctx), {
    found: true, url: "/events/abc/images/dress.jpg", external: false, scope: "event",
  });
  assert.deepEqual(resolveImage("BG", ctx), {
    found: true, url: "/cdn/images/bg.png", external: false, scope: "shared",
  });
  assert.deepEqual(resolveImage("./img-7f3a", ctx), {
    found: true, url: "/events/abc/images/img-7f3a.jpg", external: false, scope: "event",
  });
  assert.equal(resolveImage("https://x.test/a.png", ctx).found, true);
  assert.deepEqual(resolveImage("missing", ctx), { found: false });
});

import { deckLevel, questionBadge, resolveLevel, settingKeysFor } from "../../src/deck/summary";

test("badge lists only what differs from the deck's defaults", () => {
  const deck = compileDeck(DECK);
  // Numeric via category, range ±1, timer 45 on the question; points equal the deck's.
  assert.equal(questionBadge(deck.questions[0], deck), "numeric ±1 · 45s");
  assert.equal(questionBadge(deck.questions[1], deck), "multiple choice");
  assert.equal(questionBadge(deck.questions[2], deck), "100 pts");

  const plain = compileDeck("title: t\nslides:\n- q: x\n  a: y\n");
  assert.equal(questionBadge(plain.questions[0], plain), "");

  const more = compileDeck(`title: t
defaults:
  kind: numeric
slides:
- q: a
  a: 1
- q: b
  a: 1
  scoring: closest
  winners: 2
  speed-bonus: true
- q: c
  a: [x, y]
  kind: multi-answer
  num-answers: 2
`);
  assert.equal(questionBadge(more.questions[0], more), "");
  assert.equal(questionBadge(more.questions[1], more), "numeric closest 2 · speed bonus");
  assert.equal(questionBadge(more.questions[2], more), "2 answers");
});

test("inspector rows follow the question kind", () => {
  assert.deepEqual(settingKeysFor("standard", {}, false), ["kind", "timer", "points", "bonus", "speed-bonus"]);
  assert.deepEqual(settingKeysFor("numeric", { scoring: "range" }, true).slice(5), ["scoring", "within", "range-scoring", "layout"]);
  assert.deepEqual(settingKeysFor("numeric", { scoring: "closest" }, false).slice(5), ["scoring", "winners"]);
  assert.deepEqual(settingKeysFor("multiple-choice", {}, false).slice(5), ["options", "num-options"]);
  assert.deepEqual(settingKeysFor("map", {}, false).slice(5), ["full-points-km", "one-point-km"]);
});

test("category and deck levels resolve with their own source", () => {
  const deck = compileDeck(DECK);
  assert.deepEqual(deckLevel(deck, "timer"), { value: 60, source: "deck" });
  assert.deepEqual(deckLevel(deck, "bonus"), { value: 5, source: "builtin" });
  const cat = resolveLevel(deck, deck.categories[0].declared, "category");
  assert.deepEqual(cat.kind, { value: "numeric", source: "category" });
  assert.deepEqual(cat.scoring, { value: "range", source: "category" });
  assert.deepEqual(cat.timer, { value: 60, source: "deck" });
});

/** Warnings from a deck, with the text on the line each one points at. */
function warningsFor(text: string) {
  const deck = compileDeck(text);
  const lines = text.split("\n");
  return deck.problems.map((p) => ({
    message: p.message,
    severity: p.severity,
    at: p.line ? lines[p.line - 1].trim() : "",
  }));
}

test("settings a question can't use are flagged where they are written", () => {
  const problems = warningsFor(`title: t
slides:
- q: Capital of France?
  a: Paris
  within: 1
- q: Which year?
  a: 2015
  kind: numeric
  winners: 2
- q: Exactly how many?
  a: 50
  kind: numeric
  scoring: exact
  within: 3
- q: Closest wins
  a: 12
  kind: numeric
  scoring: closest
  winners: 2
`);
  assert.deepEqual(problems, [
    {
      message: "`within` only applies to numeric questions, and Question 1 is standard, so it's ignored.",
      severity: "warning",
      at: "within: 1",
    },
    {
      // `within` isn't declared, so this question uses exact scoring.
      message: "`winners` only applies to closest scoring, and Question 2 uses exact scoring, so it's ignored.",
      severity: "warning",
      at: "winners: 2",
    },
    {
      message: "`within` only applies to range scoring, and Question 3 uses exact scoring, so it's ignored.",
      severity: "warning",
      at: "within: 3",
    },
  ]);
});

test("a category setting none of its questions can use is flagged", () => {
  const problems = warningsFor(`title: t
slides:
- category: Words
  num-answers: 2
  within: 1
- q: Spell it
  a: rhythm
- category: Numbers
  kind: numeric
  within: 1
- q: How many?
  a: 7
- q: Which word?
  a: seven
  kind: standard
- category: Empty for now
  winners: 2
`);
  assert.deepEqual(problems, [
    {
      message: "`num-answers` on this category only applies to multi-answer questions, and none of its questions are multi-answer.",
      severity: "warning",
      at: "num-answers: 2",
    },
    {
      message: "`within` on this category only applies to numeric questions, and none of its questions are numeric.",
      severity: "warning",
      at: "within: 1",
    },
  ]);
});

test("multi-answer questions need an accepted answer per box", () => {
  const messages = (text: string) => compileDeck(text).problems.map((p) => p.message);
  const deck = (a: string, extra = "") =>
    `title: t\nslides:\n- q: Name the planets\n  kind: multi-answer\n${extra}  a: ${a}\n`;

  assert.deepEqual(messages(deck("Mars")), [
    "Question 1 has 1 accepted answer for 3 answer boxes, so no team can get full points from the deck's answers alone.",
  ]);
  assert.deepEqual(messages(deck("Mars, Venus")), [
    "Question 1's answer is one line, so each box is compared with the whole of it. List the accepted answers under `a:`, one per line.",
  ]);
  assert.deepEqual(messages(deck("[Mars, Venus]", "  num-answers: 2\n")), []);
  // More accepted answers than boxes is normal: "name three of the eight".
  assert.deepEqual(messages(deck("[Mercury, Venus, Earth, Mars, Jupiter]")), []);
  assert.deepEqual(messages(deck("[Mars, Venus]")), [
    "Question 1 has 2 accepted answers for 3 answer boxes, so no team can get full points from the deck's answers alone.",
  ]);
});

test("multiple-choice answers must be an option teams can pick", () => {
  const messages = (text: string) => compileDeck(`title: t\nslides:\n${text}`).problems.map((p) => p.message);

  assert.deepEqual(messages("- q: x\n  kind: multiple-choice\n  a: c\n"), []);
  assert.deepEqual(messages("- q: x\n  kind: multiple-choice\n  a: Paris\n"), [
    "Question 1's answer isn't one of the options teams can pick (A–D), so it can't be scored automatically.",
  ]);
  assert.deepEqual(messages("- q: x\n  kind: multiple-choice\n  options: yes-no\n  a: Maybe\n"), [
    "Question 1's answer isn't one of the options teams can pick (Yes or No), so it can't be scored automatically.",
  ]);
  assert.deepEqual(messages("- q: x\n  kind: multiple-choice\n  options: numbers\n  num-options: 3\n  a: 5\n"), [
    "Question 1's answer isn't one of the options teams can pick (1–3), so it can't be scored automatically.",
  ]);
  assert.deepEqual(messages("- q: x\n  kind: multiple-choice\n  choices: [a1, b1]\n  a: [a1, b1]\n"), [
    "Question 1 is multiple choice but its answer is a list. Only one option can be correct, so it can't be scored automatically.",
  ]);
  // A numbered answer names a choice when the options are numbered.
  assert.deepEqual(messages("- q: x\n  choices: [ten, twenty]\n  options: numbers\n  a: 2\n"), []);
});

test("choices on the slide must match the options on the phones", () => {
  const messages = (text: string) => compileDeck(`title: t\nslides:\n${text}`).problems.map((p) => p.message);

  assert.deepEqual(messages("- q: x\n  choices: [w, x, y]\n  options: yes-no\n  a: Yes\n"), [
    "Question 1 shows 3 choices but teams can pick from 2 options (Yes or No).",
  ]);
  // The answer names choice D, which teams aren't offered: one warning, not two.
  assert.deepEqual(messages("- q: x\n  choices: [w, x, y, z]\n  num-options: 3\n  a: z\n"), [
    "Question 1 shows 4 choices but teams can pick from 3 options (A–C).",
  ]);
  // A category's option count meets a question with a different number of choices.
  assert.deepEqual(
    messages("- category: c\n  num-options: 4\n- q: x\n  choices: [w, x, y]\n  a: w\n"),
    ["Question 1 shows 3 choices but teams can pick from 4 options (A–D)."]
  );
});
