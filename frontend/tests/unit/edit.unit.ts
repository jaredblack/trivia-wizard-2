// Unit tests for surgical deck edits. Run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addToList, applyEdit, getKey, removeFromList, setKey, type EditTarget, type EditValue } from "../../src/deck/edit";
import { compileDeck } from "../../src/deck/compile";

const DECK = `title: Trivia Night!
defaults:
  timer: 60
slides:
- join

- category: Date Your Meme
  kind: numeric

- q: "'The Dress' went viral in which year?"   # keep this comment
  a: 2015
  timer: 45
  # ask Grace for a better one

- q: Second
  a: x
  image:
  - one
  - two
  points: 10
`;

const slide = (index: number): EditTarget => ({ type: "slide", index });
const set = (text: string, t: EditTarget, key: string, value: EditValue | undefined, style?: "block" | "flow") => {
  const edit = setKey(text, t, key, value, style);
  assert.ok(edit, `expected an edit for ${key}`);
  return applyEdit(text, edit);
};

test("replaces an existing value on its own line only", () => {
  const out = set(DECK, slide(2), "timer", 90);
  assert.equal(out, DECK.replace("  timer: 45", "  timer: 90"));
});

test("adds a new key after the item's last key, before trailing comments", () => {
  const out = set(DECK, slide(2), "points", 100);
  assert.ok(out.includes("  timer: 45\n  points: 100\n  # ask Grace for a better one\n"));
  assert.equal(compileDeck(out).questions[0].settings.points.value, 100);
});

test("removes a key and nothing else", () => {
  const out = set(DECK, slide(2), "timer", undefined);
  assert.equal(out, DECK.replace("  timer: 45\n", ""));
  assert.match(out, /# keep this comment/);
});

test("edits a key that sits on the dash line", () => {
  const out = set(DECK, slide(1), "category", "Memes: dated");
  assert.match(out, /^- category: "Memes: dated"$/m);
  // The type key can't be removed.
  assert.equal(setKey(DECK, slide(1), "category", undefined), null);
});

test("replaces and removes a multi-line list value", () => {
  const single = set(DECK, slide(3), "image", "only");
  assert.ok(single.includes("  a: x\n  image: only\n  points: 10\n"));
  const gone = set(DECK, slide(3), "image", undefined);
  assert.ok(gone.includes("  a: x\n  points: 10\n"));
  const flow = set(DECK, slide(3), "location", [41.88, -87.62], "flow");
  assert.ok(flow.includes("  points: 10\n  location: [41.88, -87.62]\n"));
});

test("list helpers add and remove entries", () => {
  const added = applyEdit(DECK, addToList(DECK, slide(3), "image", "three")!);
  assert.deepEqual(getKey(added, slide(3), "image"), ["one", "two", "three"]);
  assert.equal(addToList(DECK, slide(3), "image", "two"), null);

  const first = applyEdit(DECK, addToList(DECK, slide(2), "image", "dress")!);
  assert.equal(getKey(first, slide(2), "image"), "dress");
  const second = applyEdit(first, addToList(first, slide(2), "image", "dress-2")!);
  assert.deepEqual(getKey(second, slide(2), "image"), ["dress", "dress-2"]);

  const back = applyEdit(second, removeFromList(second, slide(2), "image", "dress-2")!);
  assert.equal(getKey(back, slide(2), "image"), "dress");
  const none = applyEdit(back, removeFromList(back, slide(2), "image", "dress")!);
  assert.equal(none, DECK);
});

test("defaults are created, edited and cleaned up", () => {
  const out = set(DECK, { type: "defaults" }, "points", 25);
  assert.ok(out.includes("defaults:\n  timer: 60\n  points: 25\nslides:"));

  const noDefaults = DECK.replace("defaults:\n  timer: 60\n", "");
  const created = set(noDefaults, { type: "defaults" }, "timer", 20);
  assert.ok(created.includes("title: Trivia Night!\ndefaults:\n  timer: 20\nslides:"));

  const removed = set(DECK, { type: "defaults" }, "timer", undefined);
  assert.equal(removed, noDefaults);
});

test("quotes values that need it and skips no-op edits", () => {
  const out = set(DECK, slide(2), "within", "10%");
  assert.equal(compileDeck(out).questions[0].settings.within.value, "10%");
  assert.equal(setKey(DECK, slide(2), "timer", 45), null);
  assert.equal(setKey(DECK, slide(2), "points", undefined), null);
});

test("refuses to edit what it can't locate", () => {
  assert.equal(setKey(DECK, slide(0), "timer", 5), null); // `join` is not a mapping
  assert.equal(setKey(DECK, slide(99), "timer", 5), null);
  assert.equal(setKey("title: [oops", slide(0), "timer", 5), null);
});
