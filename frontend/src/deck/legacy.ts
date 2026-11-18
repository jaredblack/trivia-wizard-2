// Converts decks written in the original format (`type:` / `id:` on every
// slide, `images:` objects with `reveal`/`position`) to the current one.
// Works on the YAML document rather than plain data so comments, blank lines
// and quoting styles survive.

import {
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
} from "yaml";

const JOIN_IMAGE = "trivia-wizard-join-qr";

const KEY_RENAMES: Record<string, string> = {
  answer: "a",
  timerDuration: "timer",
  questionPoints: "points",
  bonusIncrement: "bonus",
  speedBonusEnabled: "speed-bonus",
};

const CONFIG_RENAMES: Record<string, string> = {
  numAnswers: "num-answers",
  numOptions: "num-options",
  fullPointsDistanceKm: "full-points-km",
  onePointDistanceKm: "one-point-km",
};

const KIND_VALUES: Record<string, string> = {
  standard: "standard",
  multiAnswer: "multi-answer",
  multipleChoice: "multiple-choice",
  numeric: "numeric",
  map: "map",
};

const OPTION_VALUES: Record<string, string> = {
  letters: "letters",
  numbers: "numbers",
  yesNo: "yes-no",
  trueFalse: "true-false",
};

const SCORING_VALUES: Record<string, string> = {
  exactOnly: "exact",
  range: "range",
  closestGuess: "closest",
};

function legacySlides(text: string) {
  // Untyped document: the conversion builds new nodes rather than parsed ones.
  const doc: Document = parseDocument(text);
  const root = doc.contents;
  const slides = isMap(root) ? root.get("slides", true) : undefined;
  return { doc, root, slides };
}

export function isLegacyDeck(text: string): boolean {
  // Cheap reject before parsing: every legacy slide has a `type:` line.
  if (!/^\s*(-\s+)?type:\s*\S/m.test(text)) return false;
  const { slides } = legacySlides(text);
  return isSeq(slides) && slides.items.some((i) => isMap(i) && i.has("type"));
}

function keyName(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : "";
}

/** A key scalar that keeps any comment the original key carried. */
function keyNode(old: Pair, name: string, extraComment?: string): Scalar {
  const k = new Scalar(name);
  if (isScalar(old.key)) {
    k.spaceBefore = old.key.spaceBefore;
    k.comment = old.key.comment;
    k.commentBefore = old.key.commentBefore;
  }
  if (extraComment) {
    k.commentBefore = k.commentBefore
      ? `${extraComment}\n${k.commentBefore}`
      : extraComment;
  }
  return k;
}

function mapped(pair: Pair, table: Record<string, string>): Scalar | null {
  const raw = isScalar(pair.value) ? String(pair.value.value) : "";
  const next = table[raw];
  return next ? new Scalar(next) : null;
}

function cleanRef(node: Scalar): Scalar {
  const value = String(node.value);
  if (!value.startsWith("./")) return node;
  const next = new Scalar(value.slice(2));
  next.type = node.type;
  next.comment = node.comment;
  return next;
}

/** Split legacy image entries into "with question" and "with answer". */
function splitImages(value: unknown): {
  question: Scalar[];
  answer: Scalar[];
  hero: boolean;
} {
  const out = { question: [] as Scalar[], answer: [] as Scalar[], hero: false };
  const entries = isSeq(value) ? value.items : isScalar(value) ? [value] : [];
  for (const entry of entries) {
    if (isScalar(entry)) {
      out.question.push(cleanRef(entry));
    } else if (isMap(entry)) {
      const url = entry.get("url", true);
      if (!isScalar(url)) continue;
      if (entry.get("position") === "center") out.hero = true;
      // The renderer has always shown an image with the question unless told
      // otherwise, whatever the old schema's description claimed.
      (entry.get("reveal") === "answer" ? out.answer : out.question).push(
        cleanRef(url)
      );
    }
  }
  return out;
}

function imageValue(refs: Scalar[]): Node {
  if (refs.length === 1) return refs[0];
  const seq = new YAMLSeq();
  seq.items = refs;
  return seq;
}

function carry(from: Node, to: Node, extraComment?: string): void {
  to.spaceBefore = from.spaceBefore;
  to.comment = from.comment;
  const before = [from.commentBefore, extraComment].filter(
    (c) => c !== undefined && c !== null && c !== ""
  );
  if (before.length) to.commentBefore = before.join("\n");
}

function moveFirst(map: YAMLMap, key: string): void {
  const idx = map.items.findIndex((p) => keyName(p) === key);
  if (idx > 0) {
    const [pair] = map.items.splice(idx, 1);
    // The item's leading blank line/comment sits on whichever key is first.
    const first = map.items[0];
    if (isScalar(first.key) && isScalar(pair.key)) {
      const { spaceBefore, commentBefore } = first.key;
      first.key.spaceBefore = pair.key.spaceBefore;
      first.key.commentBefore = pair.key.commentBefore;
      pair.key.spaceBefore = spaceBefore;
      pair.key.commentBefore = commentBefore;
    }
    map.items.unshift(pair);
  }
}

export function convertLegacyDeck(text: string): string {
  const { doc, root, slides } = legacySlides(text);
  if (doc.errors.length) {
    throw new Error(doc.errors[0].message.split("\n")[0]);
  }
  if (!isMap(root) || !isSeq(slides)) {
    throw new Error("The deck has no `slides:` list.");
  }

  let lastId: string | null = null;
  let lastQuestion: YAMLMap | null = null;
  const seen = new Set<string>();
  const items: Node[] = [];

  for (const item of slides.items as Node[]) {
    if (!isMap(item) || !item.has("type")) {
      items.push(item);
      continue;
    }
    const type = String(item.get("type"));
    const out = new YAMLMap();
    let pending: string | undefined;
    // Comments on a key we drop move to the next key we keep.
    const push = (old: Pair, name: string, value: unknown = old.value) => {
      out.items.push(new Pair(keyNode(old, name, pending), value));
      pending = undefined;
    };
    const drop = (old: Pair) => {
      const c = isScalar(old.key) ? old.key.commentBefore : undefined;
      if (c) pending = pending ? `${pending}\n${c}` : c;
    };

    if (type === "image") {
      const image = item.get("image", true);
      if (isScalar(image) && image.value === JOIN_IMAGE) {
        const join = new Scalar("join");
        carry(item, join);
        items.push(join);
        continue;
      }
      for (const pair of item.items) {
        const key = keyName(pair);
        if (key === "type") drop(pair);
        else if (key === "image" && isScalar(pair.value)) push(pair, "image", cleanRef(pair.value));
        else push(pair, key);
      }
      moveFirst(out, "image");
      carry(item, out);
      items.push(out);
      continue;
    }

    if (type === "category") {
      for (const pair of item.items) {
        const key = keyName(pair);
        if (key === "type") drop(pair);
        else if (key === "title") push(pair, "category");
        else if (key === "images") {
          const imgs = splitImages(pair.value);
          const all = [...imgs.question, ...imgs.answer];
          if (all.length) push(pair, "image", imageValue(all));
          else drop(pair);
        } else push(pair, key);
      }
      moveFirst(out, "category");
      carry(item, out);
      items.push(out);
      continue;
    }

    if (type === "question") {
      const id = String(item.get("id") ?? "").toLowerCase();
      const isThen = id !== "" && id === lastId && lastQuestion !== null;
      const reused = id !== "" && !isThen && seen.has(id);
      let hero = false;

      for (const pair of item.items) {
        const key = keyName(pair);
        if (key === "type" || key === "id") {
          drop(pair);
        } else if (key === "question") {
          push(pair, isThen ? "then" : "q");
        } else if (key === "images") {
          const imgs = splitImages(pair.value);
          hero = hero || imgs.hero;
          if (imgs.question.length) push(pair, "image", imageValue(imgs.question));
          if (imgs.answer.length) {
            if (imgs.question.length) {
              out.items.push(
                new Pair(new Scalar("answer-image"), imageValue(imgs.answer))
              );
            } else {
              push(pair, "answer-image", imageValue(imgs.answer));
            }
          }
          if (!imgs.question.length && !imgs.answer.length) drop(pair);
        } else if (key === "questionKind") {
          const value = mapped(pair, KIND_VALUES);
          if (value && !isThen) push(pair, "kind", value);
          else drop(pair);
        } else if (key === "config") {
          if (isMap(pair.value) && !isThen) {
            for (const c of pair.value.items) {
              const ck = keyName(c);
              if (ck === "optionType") {
                const value = mapped(c, OPTION_VALUES);
                if (value) push(c, "options", value);
              } else if (ck === "scoringMode") {
                const value = mapped(c, SCORING_VALUES);
                if (value) push(c, "scoring", value);
              } else if (CONFIG_RENAMES[ck]) {
                push(c, CONFIG_RENAMES[ck]);
              }
            }
          }
          drop(pair);
        } else if (KEY_RENAMES[key]) {
          // Follow-up slides take their settings from the question.
          if (isThen && key !== "answer") drop(pair);
          else push(pair, KEY_RENAMES[key]);
        } else {
          push(pair, key);
        }
      }

      if (hero) {
        const target = isThen ? lastQuestion! : out;
        if (!target.has("layout")) target.set("layout", "hero");
      }
      moveFirst(out, isThen ? "then" : "q");

      let note: string | undefined;
      if (isThen) note = ` shared id ${id.toUpperCase()} with the question above`;
      else if (reused) note = ` reused id ${id.toUpperCase()} from an earlier question; now numbered separately`;
      carry(item, out, note);
      items.push(out);

      if (!isThen) {
        lastId = id || null;
        lastQuestion = out;
        if (id) seen.add(id);
      }
      continue;
    }

    if (type === "custom") {
      for (const pair of item.items) {
        if (keyName(pair) === "type") drop(pair);
        else push(pair, keyName(pair));
      }
      carry(item, out);
      items.push(out);
      continue;
    }

    // Unknown type: leave it for the compiler to report.
    items.push(item);
  }

  const next = new YAMLSeq();
  next.items = items;
  next.comment = slides.comment;
  next.commentBefore = slides.commentBefore;
  root.set("slides", next);

  return doc.toString({ indentSeq: false, lineWidth: 0 });
}
