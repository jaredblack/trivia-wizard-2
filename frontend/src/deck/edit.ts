// Surgical edits to deck YAML: set or remove one key on one slide (or in
// `defaults:`) by replacing only the lines that key occupies. Everything else
// in the document — comments, blank lines, quoting — is left byte-for-byte
// alone, which is what lets the inspector write YAML on the author's behalf.

import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type Pair,
  type YAMLMap,
} from "yaml";

export type EditTarget =
  /** Index into the `slides:` list (not `CompiledDeck.slides`, which has the title slide first). */
  | { type: "slide"; index: number }
  | { type: "defaults" };

export type EditValue = string | number | boolean | (string | number)[];

/**
 * Replace lines `startLine..endLine` (1-based, inclusive) with `lines`.
 * `endLine === startLine - 1` is a pure insertion before `startLine`.
 */
export interface LineEdit {
  startLine: number;
  endLine: number;
  lines: string[];
}

function scalarText(value: string | number | boolean): string {
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

function valueLines(
  key: string,
  value: EditValue,
  prefix: string,
  indent: string,
  style: "block" | "flow"
): string[] {
  if (!Array.isArray(value)) return [`${prefix}${key}: ${scalarText(value)}`];
  if (style === "flow") {
    return [`${prefix}${key}: [${value.map(scalarText).join(", ")}]`];
  }
  return [`${prefix}${key}:`, ...value.map((v) => `${indent}- ${scalarText(v)}`)];
}

interface Located {
  map: YAMLMap | null;
  lc: LineCounter;
  lines: string[];
  /** Line of the `slides:` key, for creating `defaults:` above it. */
  slidesLine: number | null;
}

function locate(text: string, target: EditTarget): Located | null {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc });
  if (doc.errors.length) return null;
  const root = doc.contents;
  if (!isMap(root)) return null;
  const lines = text.split("\n");

  const slidesPair = root.items.find((p) => isScalar(p.key) && p.key.value === "slides");
  const slidesLine =
    slidesPair && isScalar(slidesPair.key) && slidesPair.key.range
      ? lc.linePos(slidesPair.key.range[0]).line
      : null;

  if (target.type === "defaults") {
    const node = root.get("defaults", true);
    return { map: isMap(node) ? node : null, lc, lines, slidesLine };
  }
  const slides = root.get("slides", true);
  if (!isSeq(slides)) return null;
  const item = slides.items[target.index];
  if (!isMap(item)) return null;
  return { map: item, lc, lines, slidesLine };
}

function findPair(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((p) => isScalar(p.key) && p.key.value === key);
}

function pairSpan(pair: Pair, lc: LineCounter): { start: number; end: number; col: number } {
  const key = pair.key as { range?: [number, number, number] };
  const startPos = lc.linePos(key.range![0]);
  let end = startPos.line;
  const value = pair.value as { range?: [number, number, number] } | null;
  if (value?.range) {
    end = Math.max(end, lc.linePos(Math.max(value.range[0], value.range[1] - 1)).line);
  }
  return { start: startPos.line, end, col: startPos.col };
}

/** The current value of `key` on the target, as plain data. */
export function getKey(text: string, target: EditTarget, key: string): unknown {
  const at = locate(text, target);
  if (!at?.map) return undefined;
  const pair = findPair(at.map, key);
  if (!pair) return undefined;
  const v = pair.value as { toJSON?: () => unknown } | null;
  return v && typeof v.toJSON === "function" ? v.toJSON() : v;
}

/**
 * Set `key` to `value` on the target, or remove it when `value` is undefined.
 * Returns null when nothing needs to change or the target can't be edited
 * (the document doesn't parse, or the slide isn't a mapping).
 */
export function setKey(
  text: string,
  target: EditTarget,
  key: string,
  value: EditValue | undefined,
  style: "block" | "flow" = "block"
): LineEdit | null {
  const at = locate(text, target);
  if (!at) return null;
  const { map, lc, lines } = at;

  if (!map) {
    // Only `defaults:` can be missing; create it just above `slides:`.
    if (target.type !== "defaults" || value === undefined || at.slidesLine === null) {
      return null;
    }
    return {
      startLine: at.slidesLine,
      endLine: at.slidesLine - 1,
      lines: ["defaults:", ...valueLines(key, value, "  ", "  ", style)],
    };
  }

  const first = map.items[0];
  if (!first || !isScalar(first.key) || !first.key.range) return null;
  const firstPos = lc.linePos(first.key.range[0]);
  const indent = " ".repeat(firstPos.col - 1);
  const pair = findPair(map, key);

  if (pair) {
    const span = pairSpan(pair, lc);
    // On the item's first line the key follows "- ", so keep whatever precedes it.
    const prefix = lines[span.start - 1].slice(0, span.col - 1);
    if (value === undefined) {
      // A slide's first key says what kind of slide it is; it stays.
      if (target.type === "slide" && pair === first) return null;
      if (target.type === "defaults" && map.items.length === 1) {
        // Removing the last default removes the now-empty `defaults:` too.
        return { startLine: span.start - 1, endLine: span.end, lines: [] };
      }
      return { startLine: span.start, endLine: span.end, lines: [] };
    }
    const next = valueLines(key, value, prefix, indent, style);
    const current = lines.slice(span.start - 1, span.end);
    if (current.length === next.length && current.every((l, i) => l === next[i])) {
      return null;
    }
    return { startLine: span.start, endLine: span.end, lines: next };
  }

  if (value === undefined) return null;
  const last = map.items[map.items.length - 1];
  const after = pairSpan(last, lc).end;
  return {
    startLine: after + 1,
    endLine: after,
    lines: valueLines(key, value, indent, indent, style),
  };
}

/** Add one entry to a key that holds a single value or a list (e.g. `image`). */
export function addToList(
  text: string,
  target: EditTarget,
  key: string,
  entry: string
): LineEdit | null {
  const current = getKey(text, target, key);
  if (current === undefined || current === null) return setKey(text, target, key, entry);
  const list = (Array.isArray(current) ? current : [current]).map(String);
  if (list.includes(entry)) return null;
  return setKey(text, target, key, [...list, entry]);
}

/** Remove one entry from such a key, dropping the key when it becomes empty. */
export function removeFromList(
  text: string,
  target: EditTarget,
  key: string,
  entry: string
): LineEdit | null {
  const current = getKey(text, target, key);
  if (current === undefined || current === null) return null;
  const list = (Array.isArray(current) ? current : [current]).map(String);
  const next = list.filter((x) => x !== entry);
  if (next.length === list.length) return null;
  if (next.length === 0) return setKey(text, target, key, undefined);
  return setKey(text, target, key, next.length === 1 ? next[0] : next);
}

/** Apply an edit to plain text. The editor applies edits itself to keep undo. */
export function applyEdit(text: string, edit: LineEdit): string {
  const lines = text.split("\n");
  lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...edit.lines);
  return lines.join("\n");
}
