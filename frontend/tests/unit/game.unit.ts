// Unit tests for turning a deck into game presets. Run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileDeck } from "../../src/deck/compile";
import { answerForHost, buildPresets, correctOptionLabel } from "../../src/deck/game";

const DECK = `title: T
defaults:
  timer: 60
slides:
- q: Capital of France?
  a: Paris

- category: Memes
  kind: numeric
  within: 1
  points: 100

- q: Which year?
  a: "2015"
  timer: 45

- q: Roughly how many?
  a: 5000
  within: 10%
  range-scoring: flat

- q: Closest wins
  a: 12
  scoring: closest
  winners: 2

- category: Mixed

- q: Most popular vehicle?
  a: Ford F-150
  choices: [Toyota Rav4, Ford F-150, Honda CR-V]

- q: Pick a number
  a: Honda CR-V
  choices: [Toyota Rav4, Ford F-150, Honda CR-V]
  options: numbers

- q: Is it true?
  a: true
  kind: multiple-choice
  options: true-false

- q: Name two planets
  a: [Mars, Venus]
  kind: multi-answer
  num-answers: 2
  speed-bonus: true

- q: Where is the Bean?
  kind: map
  location: [41.8827, -87.6233]
  full-points-km: 1

- q: Rank them
  choices: [x, y]
  a: [y, x]

- q: No answer yet
`;

test("a preset carries only what the deck declares", () => {
  const presets = buildPresets(compileDeck(DECK));
  assert.equal(presets.length, 11);

  // Timer comes from `defaults`; kind, points and bonus are left to the game.
  assert.deepEqual(presets[0], { timerDuration: 60, answerKey: ["Paris"] });

  assert.deepEqual(presets[1], {
    timerDuration: 45,
    questionPoints: 100,
    kind: "numeric",
    scoringMode: "range",
    rangeType: "absolute",
    rangeValue: 1,
    answerKey: ["2015"],
    numericCorrectAnswer: 2015,
  });

  assert.deepEqual(presets[2], {
    timerDuration: 60,
    questionPoints: 100,
    kind: "numeric",
    scoringMode: "range",
    rangeType: "percent",
    rangeValue: 10,
    rangeScoringType: "flat",
    answerKey: ["5000"],
    numericCorrectAnswer: 5000,
  });

  assert.equal(presets[3].scoringMode, "closestGuess");
  assert.equal(presets[3].numWinners, 2);
  // `within` is still inherited from the category.
  assert.equal(presets[3].rangeValue, 1);
});

test("multiple choice keys are the label teams tap", () => {
  const deck = compileDeck(DECK);
  const presets = buildPresets(deck);

  assert.deepEqual(presets[4], {
    timerDuration: 60,
    kind: "multipleChoice",
    numOptions: 3,
    answerKey: ["B"],
  });
  assert.deepEqual(presets[5].answerKey, ["3"]);
  assert.equal(presets[5].optionType, "numbers");
  // The option as teams see it; the server compares without case.
  assert.deepEqual(presets[6].answerKey, ["True"]);
  assert.equal(presets[6].optionType, "trueFalse");

  assert.equal(correctOptionLabel(deck.questions[4]), "B");
  assert.equal(answerForHost(deck.questions[4]), "B. Ford F-150");
  assert.equal(answerForHost(deck.questions[5]), "3. Honda CR-V");
  assert.equal(answerForHost(deck.questions[6]), "True");
});

test("other kinds get the key that fits them", () => {
  const deck = compileDeck(DECK);
  const presets = buildPresets(deck);

  assert.deepEqual(presets[7], {
    timerDuration: 60,
    speedBonusEnabled: true,
    kind: "multiAnswer",
    numAnswers: 2,
    multiAnswerCorrectSet: ["Mars", "Venus"],
  });
  assert.deepEqual(presets[8], {
    timerDuration: 60,
    kind: "map",
    fullPointsDistanceKm: 1,
    mapCorrectLocation: [41.8827, -87.6233],
  });
  // A ranking is scored by hand; a question with no answer has no key.
  assert.deepEqual(presets[9], { timerDuration: 60 });
  assert.deepEqual(presets[10], { timerDuration: 60 });

  assert.equal(answerForHost(deck.questions[7]), "Mars, Venus");
  assert.equal(answerForHost(deck.questions[8]), "41.8827, -87.6233");
  assert.equal(answerForHost(deck.questions[9]), "y, x");
  assert.equal(answerForHost(deck.questions[10]), "");
});

test("a deck that declares nothing produces empty presets", () => {
  const presets = buildPresets(compileDeck("title: t\nslides:\n- q: One\n- q: Two\n"));
  assert.deepEqual(presets, [{}, {}]);
});

test("multiple choice keys follow the options teams are offered", () => {
  const deck = compileDeck(`title: t
slides:
- q: Numbered, answered by number
  choices: [ten, twenty, thirty]
  options: numbers
  a: 2
- q: Yes or no, with the choices written out
  choices: ["No", "Yes"]
  options: yes-no
  a: B
- q: Letters with no choices on the slide
  kind: multiple-choice
  a: c
- q: An answer that isn't an option
  kind: multiple-choice
  a: Paris
- q: Fewer options than choices
  choices: [w, x, y, z]
  num-options: 3
  a: z
`);
  const presets = buildPresets(deck);
  assert.deepEqual(presets[0].answerKey, ["2"]);
  assert.equal(answerForHost(deck.questions[0]), "2. twenty");
  // Choice B is "Yes", whatever order the choices are written in.
  assert.deepEqual(presets[1].answerKey, ["Yes"]);
  assert.deepEqual(presets[2].answerKey, ["C"]);
  // No key for answers teams can't pick, so nothing is scored wrongly.
  assert.equal(presets[3].answerKey, undefined);
  assert.equal(presets[4].answerKey, undefined);
});
