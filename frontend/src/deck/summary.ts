// What to show about a question's settings: which rows the inspector lists for
// a kind, and the one-line badge the editor puts after questions that differ
// from the deck's defaults.

import {
  SETTINGS,
  formatSetting,
  settingDef,
  type Kind,
  type SettingKey,
  type SettingValue,
} from "./settings";
import type {
  CompiledDeck,
  DeckQuestion,
  DeclaredSettings,
  ResolvedSetting,
  SettingSource,
} from "./types";

const GENERAL: SettingKey[] = ["kind", "timer", "points", "bonus", "speed-bonus"];

/** Settings worth showing for a question of this kind, in display order. */
export function settingKeysFor(
  kind: Kind,
  values: Partial<Record<SettingKey, SettingValue>>,
  hasImages: boolean
): SettingKey[] {
  const keys = [...GENERAL];
  if (kind === "multi-answer") keys.push("num-answers");
  if (kind === "multiple-choice") keys.push("options", "num-options");
  if (kind === "numeric") {
    keys.push("scoring");
    if (values.scoring === "range") keys.push("within", "range-scoring");
    if (values.scoring === "closest") keys.push("winners");
  }
  if (kind === "map") keys.push("full-points-km", "one-point-km");
  if (hasImages) keys.push("layout");
  return keys;
}

/** What a setting resolves to at deck level: `defaults:` or the built-in. */
export function deckLevel(deck: CompiledDeck, key: SettingKey): ResolvedSetting {
  const declared = deck.defaults[key];
  return declared !== undefined
    ? { value: declared, source: "deck" }
    : { value: settingDef(key).builtin, source: "builtin" };
}

/** Resolve every setting for a level that only has its own declarations and the deck's. */
export function resolveLevel(
  deck: CompiledDeck,
  own: DeclaredSettings,
  ownSource: SettingSource
): Record<SettingKey, ResolvedSetting> {
  const out = {} as Record<SettingKey, ResolvedSetting>;
  for (const def of SETTINGS) {
    const v = own[def.key];
    out[def.key] = v !== undefined ? { value: v, source: ownSource } : deckLevel(deck, def.key);
  }
  if (own.scoring === undefined && deck.defaults.scoring === undefined && out.within.source !== "builtin") {
    out.scoring = { value: "range", source: out.within.source };
  }
  return out;
}

/**
 * A compact note of how a question differs from the deck's defaults, e.g.
 * "numeric ±1 · 45s". Empty when it doesn't.
 */
export function questionBadge(q: DeckQuestion, deck: CompiledDeck): string {
  const differs = (key: SettingKey) => q.settings[key].value !== deckLevel(deck, key).value;
  const parts: string[] = [];

  const kindDiffers = differs("kind");
  let kindPart = kindDiffers ? formatSetting("kind", q.kind).toLowerCase() : "";
  if (q.kind === "numeric" && (kindDiffers || differs("scoring") || differs("within") || differs("winners"))) {
    const scoring = q.settings.scoring.value;
    const detail =
      scoring === "range"
        ? formatSetting("within", q.settings.within.value)
        : scoring === "closest"
          ? `closest ${q.settings.winners.value}`
          : "exact";
    kindPart = `numeric ${detail}`;
  }
  if (q.kind === "multi-answer" && (kindDiffers || differs("num-answers"))) {
    kindPart = `${q.settings["num-answers"].value} answers`;
  }
  if (kindPart) parts.push(kindPart);

  if (differs("timer")) parts.push(formatSetting("timer", q.settings.timer.value));
  if (differs("points")) parts.push(`${q.settings.points.value} pts`);
  if (differs("bonus")) parts.push(`bonus ${q.settings.bonus.value}`);
  if (differs("speed-bonus")) {
    parts.push(q.settings["speed-bonus"].value ? "speed bonus" : "no speed bonus");
  }
  return parts.join(" · ");
}
