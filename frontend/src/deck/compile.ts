// Turns deck YAML into the model everything else consumes: the slide renderer,
// the editor (gutter numbers, image previews, inspector) and the live game.
// Pure: no I/O, no DOM.

import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Node,
  type YAMLMap,
} from "yaml";
import {
  KIND_LABELS,
  SETTINGS,
  checkSettingValue,
  isSettingKey,
  settingDef,
  type Kind,
  type SettingKey,
} from "./settings";
import { convertLegacyDeck, isLegacyDeck } from "./legacy";
import {
  choiceLabels as labelChoices,
  correctOptionLabel,
  describeOptions,
  matchChoice,
  optionLabels,
} from "./choices";
export { matchChoice } from "./choices";

import type {
  CompiledDeck,
  DeckCategory,
  DeckQuestion,
  DeckSlide,
  DeclaredSettings,
  LineRange,
  Problem,
  QuestionSlide,
  ResolvedSettings,
} from "./types";

const PLACEHOLDERS = new Set([
  "question text",
  "answer text",
  "sample question?",
  "sample answer",
]);

const QUESTION_KEYS = new Set([
  "q",
  "a",
  "choices",
  "matching",
  "image",
  "answer-image",
  "location",
  "notes",
]);
const THEN_KEYS = new Set([
  "then",
  "a",
  "choices",
  "matching",
  "image",
  "answer-image",
  "notes",
]);
const CATEGORY_KEYS = new Set(["category", "subtitle", "image", "notes"]);

function str(x: unknown): string | undefined {
  return x === null || x === undefined ? undefined : String(x);
}

function strList(x: unknown): string[] {
  if (x === null || x === undefined) return [];
  const list = Array.isArray(x) ? x : [x];
  return list.filter((v) => v !== null && v !== undefined).map(String);
}

/** A number from an answer such as 2015, "2015", "$1,000" or "12%". */
export function parseNumericAnswer(answer: unknown): number | null {
  if (typeof answer === "number") return Number.isFinite(answer) ? answer : null;
  if (typeof answer !== "string") return null;
  const cleaned = answer.replace(/[\s,$£€%]/g, "");
  if (cleaned === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  return Number(cleaned);
}

function yamlMessage(message: string): string {
  // The library appends a source excerpt after the first line.
  return message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "");
}

function emptyDeck(problems: Problem[]): CompiledDeck {
  return {
    title: "",
    defaults: {},
    slides: [{ type: "title", title: "Trivia Night" }],
    questions: [],
    categories: [],
    images: [],
    problems,
    legacy: false,
  };
}

export function compileDeck(text: string): CompiledDeck {
  if (isLegacyDeck(text)) {
    try {
      const deck = compileCurrent(convertLegacyDeck(text));
      return { ...deck, legacy: true };
    } catch (e) {
      return {
        ...emptyDeck([
          {
            severity: "error",
            message: `This deck is in the old format and could not be converted: ${
              e instanceof Error ? e.message : String(e)
            }`,
          },
        ]),
        legacy: true,
      };
    }
  }
  return compileCurrent(text);
}

function compileCurrent(text: string): CompiledDeck {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc });
  const problems: Problem[] = [];
  for (const e of doc.errors) {
    problems.push({
      severity: "error",
      message: yamlMessage(e.message),
      line: e.linePos?.[0]?.line,
    });
  }

  const lines = text.split("\n");
  const lineOf = (offset: number) => lc.linePos(offset).line;

  const root = doc.contents;
  if (!isMap(root)) {
    if (text.trim() !== "") {
      problems.push({
        severity: "error",
        message: "A deck starts with `title:` and a `slides:` list.",
        line: 1,
      });
    }
    return emptyDeck(problems);
  }

  const keyLine = (map: YAMLMap, key: string): number | undefined => {
    const pair = map.items.find((p) => isScalar(p.key) && p.key.value === key);
    const range = pair && isScalar(pair.key) ? pair.key.range : undefined;
    return range ? lineOf(range[0]) : undefined;
  };

  const readDeclared = (
    map: YAMLMap,
    allowed: Set<string> | null,
    what: string
  ): DeclaredSettings => {
    const out: DeclaredSettings = {};
    for (const pair of map.items) {
      if (!isScalar(pair.key)) continue;
      const key = String(pair.key.value);
      const line = pair.key.range ? lineOf(pair.key.range[0]) : undefined;
      if (!isSettingKey(key)) {
        if (allowed && !allowed.has(key)) {
          problems.push({
            severity: "error",
            message: `\`${key}\` isn't something ${what} understands.`,
            line,
          });
        }
        continue;
      }
      const raw = isNode(pair.value) ? pair.value.toJS(doc) : pair.value;
      const checked = checkSettingValue(key, raw);
      if (checked.ok) out[key] = checked.value;
      else problems.push({ severity: "error", message: checked.reason, line });
    }
    return out;
  };

  const title = str(root.get("title")) ?? "";
  const subtitle = str(root.get("subtitle")) || undefined;

  const defaultsNode = root.get("defaults", true);
  const defaults = isMap(defaultsNode)
    ? readDeclared(defaultsNode, new Set(), "`defaults`")
    : {};

  const deck: CompiledDeck = {
    title,
    subtitle,
    defaults,
    defaultsLine: keyLine(root, "defaults"),
    slidesLine: keyLine(root, "slides"),
    slides: [{ type: "title", title: title || "Trivia Night", subtitle }],
    questions: [],
    categories: [],
    images: [],
    problems,
    legacy: false,
  };

  const slidesNode = root.get("slides", true);
  if (!isSeq(slidesNode)) {
    problems.push({
      severity: "error",
      message: "The deck has no `slides:` list.",
      line: deck.slidesLine ?? 1,
    });
    return deck;
  }

  const items = slidesNode.items.filter(isNode);
  const starts = items.map((n) => (n.range ? lineOf(n.range[0]) : 1));
  // The list ends where the document does, unless another top-level key follows.
  let listEnd = lines.length;
  while (listEnd > 1 && lines[listEnd - 1].trim() === "") listEnd--;
  if (slidesNode.range) {
    const after = lineOf(Math.max(slidesNode.range[0], slidesNode.range[2] - 1));
    listEnd = Math.min(listEnd, Math.max(after, starts[starts.length - 1] ?? 1));
  }

  const rangeOf = (i: number): LineRange => {
    const node = items[i];
    const startLine = starts[i];
    const endLine = i + 1 < items.length ? starts[i + 1] - 1 : listEnd;
    let contentEndLine = startLine;
    if (node.range) {
      contentEndLine = lineOf(Math.max(node.range[0], node.range[1] - 1));
    }
    contentEndLine = Math.min(Math.max(contentEndLine, startLine), endLine);
    while (
      contentEndLine > startLine &&
      lines[contentEndLine - 1].trim() === ""
    ) {
      contentEndLine--;
    }
    return { startLine, contentEndLine, endLine: Math.max(endLine, startLine) };
  };

  const collectImages = (
    map: YAMLMap,
    key: "image" | "answer-image"
  ): string[] => {
    const node = map.get(key, true);
    const nodes = isSeq(node) ? node.items.filter(isNode) : isNode(node) ? [node] : [];
    const refs: string[] = [];
    for (const n of nodes) {
      if (!isScalar(n) || n.value === null || n.value === undefined) continue;
      const ref = String(n.value);
      refs.push(ref);
      if (n.range) {
        const pos = lc.linePos(n.range[0]);
        const quoted = n.type === "QUOTE_DOUBLE" || n.type === "QUOTE_SINGLE";
        const col = pos.col + (quoted ? 1 : 0);
        deck.images.push({
          ref,
          when: key === "image" ? "question" : "answer",
          line: pos.line,
          col,
          endCol: col + ref.length,
        });
      }
    }
    return refs;
  };

  let category: { index: number; data: DeckCategory } | null = null;
  // Where each category's settings are written, for warnings about them.
  const categoryKeyLines: Partial<Record<SettingKey, number>>[] = [];
  let lastQuestion: DeckQuestion | null = null;

  const compileItem = (item: Node, i: number) => {
    const range = rangeOf(i);
    const line = range.startLine;

    if (isScalar(item)) {
      if (item.value === "join") {
        deck.slides.push({ type: "join", range });
      } else {
        problems.push({
          severity: "error",
          message:
            item.value === null
              ? "This slide is empty."
              : `\`${String(item.value)}\` isn't a slide. Did you mean \`q: ${String(
                  item.value
                )}\`?`,
          line,
        });
      }
      return;
    }
    if (!isMap(item)) {
      problems.push({ severity: "error", message: "This slide isn't valid.", line });
      return;
    }

    const v = item.toJS(doc) as Record<string, unknown>;
    const notes = str(v.notes);

    if ("join" in v) {
      deck.slides.push({ type: "join", range, notes });
      return;
    }

    if ("category" in v) {
      const data: DeckCategory = {
        title: str(v.category) ?? "",
        declared: readDeclared(item, CATEGORY_KEYS, "a category"),
        range,
        questionNumbers: [],
      };
      category = { index: deck.categories.length, data };
      deck.categories.push(data);
      categoryKeyLines.push(
        Object.fromEntries(
          Object.keys(data.declared).map((k) => [k, keyLine(item, k) ?? line])
        )
      );
      deck.slides.push({
        type: "category",
        title: data.title,
        subtitle: str(v.subtitle),
        images: collectImages(item, "image"),
        categoryIndex: category.index,
        notes,
        range,
      });
      return;
    }

    if ("q" in v) {
      const declared = readDeclared(item, QUESTION_KEYS, "a question");
      const choices = strList(v.choices);
      const answer = normalizeAnswer(v.a);
      const settings = resolveSettings(
        declared,
        category?.data.declared ?? {},
        defaults,
        choices,
        answer
      );
      const number = deck.questions.length + 1;
      const question: DeckQuestion = {
        number,
        text: str(v.q) ?? "",
        answer,
        choices: choices.length ? choices : undefined,
        kind: settings.kind.value as Kind,
        settings,
        declared,
        categoryIndex: category?.index,
        slideIndexes: [deck.slides.length],
        range,
      };
      if (v.location !== undefined) {
        const loc = v.location;
        if (
          Array.isArray(loc) &&
          loc.length === 2 &&
          loc.every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          question.location = [loc[0] as number, loc[1] as number];
        } else {
          problems.push({
            severity: "error",
            message: "`location` must be two numbers: [latitude, longitude].",
            line: keyLine(item, "location") ?? line,
          });
        }
      }
      for (const key of Object.keys(declared) as SettingKey[]) {
        const reason = unusedSettingReason(key, question);
        if (reason) {
          problems.push({
            severity: "warning",
            message: `\`${key}\` ${reason}, and Question ${number} ${describeUse(key, question)}, so it's ignored.`,
            line: keyLine(item, key) ?? line,
          });
        }
      }
      category?.data.questionNumbers.push(number);
      deck.questions.push(question);
      lastQuestion = question;
      deck.slides.push(
        questionSlide(v, "main", question, range, notes, {
          images: collectImages(item, "image"),
          answerImages: collectImages(item, "answer-image"),
        })
      );
      return;
    }

    if ("then" in v) {
      // Still collect so the editor can preview them even if misplaced.
      const images = collectImages(item, "image");
      const answerImages = collectImages(item, "answer-image");
      readDeclared(item, THEN_KEYS, "a follow-up slide");
      for (const key of Object.keys(v)) {
        if (isSettingKey(key)) {
          problems.push({
            severity: "error",
            message: `A follow-up slide takes its settings from its question; move \`${key}\` up to the \`q:\`.`,
            line: keyLine(item, key) ?? line,
          });
        }
      }
      if (!lastQuestion) {
        problems.push({
          severity: "error",
          message: "`then:` adds a slide to the question above it, but there is no question above this one.",
          line,
        });
        return;
      }
      const q: DeckQuestion = lastQuestion;
      q.slideIndexes.push(deck.slides.length);
      const thenAnswer = normalizeAnswer(v.a);
      if (q.answer === undefined && thenAnswer !== undefined) q.answer = thenAnswer;
      deck.slides.push(
        questionSlide({ ...v, q: v.then }, "then", q, range, notes, {
          images,
          answerImages,
        })
      );
      return;
    }

    if ("html" in v || "file" in v) {
      deck.slides.push({
        type: "custom",
        html: str(v.html),
        file: str(v.file),
        notes,
        range,
      });
      return;
    }

    if ("image" in v) {
      const refs = collectImages(item, "image");
      deck.slides.push({
        type: "image",
        title: str(v.title),
        image: refs[0],
        notes,
        range,
      });
      return;
    }

    problems.push({
      severity: "error",
      message:
        "This slide needs one of `q`, `then`, `category`, `image`, `html` or `file`.",
      line,
    });
  };

  // Positions in the YAML list, which the editor needs to address a slide.
  const listIndex: number[] = [];
  slidesNode.items.forEach((n, idx) => {
    if (isNode(n)) listIndex.push(idx);
  });
  items.forEach((item, i) => {
    const before = deck.slides.length;
    compileItem(item, i);
    for (let s = before; s < deck.slides.length; s++) {
      deck.slides[s].itemIndex = listIndex[i];
    }
  });

  deck.categories.forEach((cat, i) => {
    const qs = cat.questionNumbers.map((n) => deck.questions[n - 1]);
    if (qs.length === 0) return;
    for (const key of Object.keys(cat.declared) as SettingKey[]) {
      const kinds = settingDef(key).kinds;
      if (!kinds || qs.some((q) => kinds.includes(q.kind))) continue;
      const names = kindNames(kinds);
      problems.push({
        severity: "warning",
        message: `\`${key}\` on this category only applies to ${names} questions, and none of its questions are ${names}.`,
        line: categoryKeyLines[i][key] ?? cat.range.startLine,
      });
    }
  });

  for (const q of deck.questions) checkQuestion(q, problems);
  return deck;
}

function isNode(x: unknown): x is Node {
  return isScalar(x) || isMap(x) || isSeq(x);
}

function normalizeAnswer(a: unknown): DeckQuestion["answer"] {
  if (a === null || a === undefined) return undefined;
  if (Array.isArray(a)) {
    return a
      .filter((x) => x !== null && x !== undefined)
      .map((x) => (typeof x === "number" ? x : String(x)));
  }
  return typeof a === "number" ? a : String(a);
}

function resolveSettings(
  question: DeclaredSettings,
  category: DeclaredSettings,
  defaults: DeclaredSettings,
  choices: string[],
  answer: DeckQuestion["answer"]
): ResolvedSettings {
  const out = {} as ResolvedSettings;
  for (const def of SETTINGS) {
    const k = def.key;
    if (question[k] !== undefined) out[k] = { value: question[k], source: "question" };
    else if (category[k] !== undefined) out[k] = { value: category[k], source: "category" };
    else if (defaults[k] !== undefined) out[k] = { value: defaults[k], source: "deck" };
    else out[k] = { value: def.builtin, source: "builtin" };
  }
  // A list answer is a ranking: the choices are shown, not picked from.
  if (out.kind.source === "builtin" && choices.length >= 2 && !Array.isArray(answer)) {
    out.kind = { value: "multiple-choice", source: "implied" };
  }
  if (out["num-options"].source === "builtin" && choices.length >= 2) {
    out["num-options"] = { value: choices.length, source: "implied" };
  }
  // "Name the five Great Lakes": one box per accepted answer, unless the deck
  // says otherwise ("name any three").
  if (out["num-answers"].source === "builtin" && Array.isArray(answer) && answer.length >= 1) {
    out["num-answers"] = { value: answer.length, source: "implied" };
  }
  if (out.scoring.source === "builtin" && out.within.source !== "builtin") {
    out.scoring = { value: "range", source: out.within.source };
  }
  return out;
}

function questionSlide(
  v: Record<string, unknown>,
  part: "main" | "then",
  question: DeckQuestion,
  range: LineRange,
  notes: string | undefined,
  imgs: { images: string[]; answerImages: string[] }
): QuestionSlide {
  const choices = strList(v.choices);
  const answer = normalizeAnswer(v.a);
  const optionType =
    question.kind === "multiple-choice" ? String(question.settings.options.value) : "letters";
  const choiceLabels = choices.length ? labelChoices(optionType, choices.length) : undefined;
  let answerText: string | undefined;
  let answerList: string[] | undefined;
  if (Array.isArray(answer)) {
    // With choices on screen the list takes their place; otherwise it reads as
    // one line.
    if (choices.length) answerList = answer.map(String);
    else answerText = answer.join(", ");
  } else if (answer !== undefined) {
    answerText = String(answer);
    // An answer naming one of the choices reads as "C. Cookies".
    const idx = choiceLabels ? matchChoice(answer, choices, optionType) : -1;
    if (choiceLabels && idx !== -1) {
      const label = choiceLabels[idx];
      const text = choices[idx];
      answerText =
        label.toLowerCase() === text.trim().toLowerCase() ? text : `${label}. ${text}`;
    }
  }

  let matching: QuestionSlide["matching"];
  const m = v.matching as { left?: unknown; right?: unknown } | undefined;
  if (m && typeof m === "object") {
    matching = { left: strList(m.left), right: strList(m.right) };
  }

  return {
    type: "question",
    questionNumber: question.number,
    part,
    text: str(v.q) ?? "",
    answerText,
    answerList,
    choices: choices.length ? choices : undefined,
    choiceLabels,
    matching,
    images: imgs.images,
    answerImages: imgs.answerImages,
    layout: question.settings.layout.value === "hero" ? "hero" : "side",
    hasReveal:
      answerText !== undefined ||
      answerList !== undefined ||
      imgs.answerImages.length > 0,
    notes,
    range,
  };
}

const kindName = (kind: Kind) => KIND_LABELS[kind].toLowerCase();
const kindNames = (kinds: Kind[]) => kinds.map(kindName).join(" and ");

// Settings that only matter under one numeric scoring mode.
const SCORING_ONLY: Partial<Record<SettingKey, string>> = {
  within: "range",
  "range-scoring": "range",
  winners: "closest",
};

/** Why a setting declared on a question does nothing there, or null if it is used. */
function unusedSettingReason(key: SettingKey, q: DeckQuestion): string | null {
  const kinds = settingDef(key).kinds;
  if (kinds && !kinds.includes(q.kind)) return `only applies to ${kindNames(kinds)} questions`;
  const mode = SCORING_ONLY[key];
  if (q.kind === "numeric" && mode && q.settings.scoring.value !== mode) {
    return `only applies to ${mode} scoring`;
  }
  return null;
}

function describeUse(key: SettingKey, q: DeckQuestion): string {
  return settingDef(key).kinds?.includes(q.kind)
    ? `uses ${String(q.settings.scoring.value)} scoring`
    : `is ${kindName(q.kind)}`;
}

function checkQuestion(q: DeckQuestion, problems: Problem[]): void {
  const line = q.range.startLine;
  const warn = (message: string) =>
    problems.push({ severity: "warning", message, line });
  const name = `Question ${q.number}`;

  if (q.text.trim() === "") warn(`${name} has no text.`);

  const answerStr =
    q.answer !== undefined && !Array.isArray(q.answer) ? String(q.answer) : "";
  if (
    PLACEHOLDERS.has(q.text.trim().toLowerCase()) ||
    PLACEHOLDERS.has(answerStr.trim().toLowerCase())
  ) {
    warn(`${name} still has placeholder text.`);
  }

  if (q.kind === "map") {
    if (!q.location) {
      warn(`${name} is a map question with no \`location\`, so you'll set it while scoring.`);
    }
    return;
  }

  if (q.answer === undefined) {
    warn(`${name} has no answer.`);
    return;
  }

  if (q.kind === "multiple-choice") checkMultipleChoice(q, name, warn);
  if (q.kind === "multi-answer") checkMultiAnswer(q, name, warn);
  if (q.kind === "numeric" && parseNumericAnswer(q.answer) === null) {
    warn(`${name} is numeric but its answer isn't a number, so it can't be scored automatically.`);
  }
}

function checkMultipleChoice(q: DeckQuestion, name: string, warn: (m: string) => void): void {
  const optionType = String(q.settings.options.value);
  const labels = optionLabels(optionType, Number(q.settings["num-options"].value));

  if (Array.isArray(q.answer)) {
    warn(`${name} is multiple choice but its answer is a list. Only one option can be correct, so it can't be scored automatically.`);
  } else if (correctOptionLabel(q) === null) {
    if (!q.choices) {
      warn(`${name}'s answer isn't one of the options teams can pick (${describeOptions(labels)}), so it can't be scored automatically.`);
    } else if (matchChoice(q.answer, q.choices, optionType) === -1) {
      warn(`${name}'s answer isn't one of its choices, so it can't be scored automatically.`);
    }
    // Otherwise it names a choice teams aren't offered; the count check says so.
  }

  if (q.choices && q.choices.length !== labels.length) {
    const n = q.choices.length;
    warn(`${name} shows ${n} choice${n === 1 ? "" : "s"} but teams can pick from ${labels.length} options (${describeOptions(labels)}).`);
  }
}

function checkMultiAnswer(q: DeckQuestion, name: string, warn: (m: string) => void): void {
  const boxes = Number(q.settings["num-answers"].value);
  if (!Array.isArray(q.answer) && /[,;]/.test(String(q.answer))) {
    warn(`${name}'s answer is one line, so each box is compared with the whole of it. List the accepted answers under \`a:\`, one per line.`);
    return;
  }
  const accepted = Array.isArray(q.answer) ? q.answer.length : 1;
  if (accepted < boxes) {
    warn(`${name} has ${accepted} accepted answer${accepted === 1 ? "" : "s"} for ${boxes} answer boxes, so no team can get full points from the deck's answers alone.`);
  }
}

/** The slide a 1-based source line belongs to, as an index into `deck.slides`. */
export function slideIndexAtLine(deck: CompiledDeck, line: number): number {
  let found = -1;
  deck.slides.forEach((s: DeckSlide, i) => {
    if (s.range && s.range.startLine <= line) found = i;
  });
  return found;
}
