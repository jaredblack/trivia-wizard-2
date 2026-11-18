// The single definition of every deck setting: its key, the value it accepts,
// and what applies when nothing is declared. The JSON schema the editor
// validates against (schema.ts), the cascade (compile.ts) and the inspector all
// read from this table, so documentation and behaviour cannot drift apart.

export type Kind =
  | "standard"
  | "multi-answer"
  | "multiple-choice"
  | "numeric"
  | "map";

export const KINDS: Kind[] = [
  "standard",
  "multi-answer",
  "multiple-choice",
  "numeric",
  "map",
];

export const KIND_LABELS: Record<Kind, string> = {
  standard: "Standard",
  "multi-answer": "Multi-answer",
  "multiple-choice": "Multiple choice",
  numeric: "Numeric",
  map: "Map",
};

export type SettingKey =
  | "kind"
  | "timer"
  | "points"
  | "bonus"
  | "speed-bonus"
  | "layout"
  | "num-answers"
  | "options"
  | "num-options"
  | "scoring"
  | "within"
  | "range-scoring"
  | "winners"
  | "full-points-km"
  | "one-point-km";

export type SettingValue = string | number | boolean;

export type SettingType =
  | { type: "enum"; values: string[] }
  | { type: "integer"; min: number }
  | { type: "number"; min: number }
  | { type: "boolean" }
  // A plain number (absolute distance) or a percentage string such as "10%".
  | { type: "range" };

export interface SettingDef {
  key: SettingKey;
  label: string;
  description: string;
  value: SettingType;
  /** What applies when the deck declares nothing at any level. */
  builtin: SettingValue;
  /** Only meaningful for these question kinds; omitted = every kind. */
  kinds?: Kind[];
}

export const SETTINGS: SettingDef[] = [
  {
    key: "kind",
    label: "Type",
    description:
      "How teams answer and how the question is scored. A question with `choices` is multiple-choice unless a kind is declared.",
    value: { type: "enum", values: KINDS },
    builtin: "standard",
  },
  {
    key: "timer",
    label: "Timer",
    description: "Countdown length in seconds.",
    value: { type: "integer", min: 1 },
    builtin: 30,
  },
  {
    key: "points",
    label: "Points",
    description: "Points for a correct answer.",
    value: { type: "integer", min: 0 },
    builtin: 50,
  },
  {
    key: "bonus",
    label: "Bonus step",
    description: "Step size of the bonus +/- buttons while scoring.",
    value: { type: "integer", min: 0 },
    builtin: 5,
  },
  {
    key: "speed-bonus",
    label: "Speed bonus",
    description: "Whether the fastest correct teams earn extra points.",
    value: { type: "boolean" },
    builtin: false,
  },
  {
    key: "layout",
    label: "Image layout",
    description:
      "Where images sit on the slide. `side` puts them beside the text; `hero` gives them most of the slide.",
    value: { type: "enum", values: ["side", "hero"] },
    builtin: "side",
  },
  {
    key: "num-answers",
    label: "Answer boxes",
    description: "How many answers each team fills in.",
    value: { type: "integer", min: 1 },
    builtin: 3,
    kinds: ["multi-answer"],
  },
  {
    key: "options",
    label: "Option labels",
    description: "What the buttons on team phones are labelled with.",
    value: {
      type: "enum",
      values: ["letters", "numbers", "yes-no", "true-false"],
    },
    builtin: "letters",
    kinds: ["multiple-choice"],
  },
  {
    key: "num-options",
    label: "Options",
    description:
      "How many options teams choose from. Follows the number of `choices` when they are listed.",
    value: { type: "integer", min: 2 },
    builtin: 4,
    kinds: ["multiple-choice"],
  },
  {
    key: "scoring",
    label: "Scoring",
    description:
      "`exact` scores only the exact number, `range` scores answers `within` a distance, `closest` rewards the nearest `winners` teams. Declaring `within` on its own means `range`.",
    value: { type: "enum", values: ["exact", "range", "closest"] },
    builtin: "exact",
    kinds: ["numeric"],
  },
  {
    key: "within",
    label: "Within",
    description:
      "For range scoring: how far from the answer still earns points. A number is an absolute distance; a percentage such as `10%` is relative to the answer.",
    value: { type: "range" },
    builtin: 5,
    kinds: ["numeric"],
  },
  {
    key: "range-scoring",
    label: "Range points",
    description:
      "For range scoring: `linear` gives fewer points the further off an answer is, `flat` gives full points anywhere inside the range.",
    value: { type: "enum", values: ["linear", "flat"] },
    builtin: "linear",
    kinds: ["numeric"],
  },
  {
    key: "winners",
    label: "Winners",
    description: "For closest scoring: how many of the nearest teams earn points.",
    value: { type: "integer", min: 1 },
    builtin: 3,
    kinds: ["numeric"],
  },
  {
    key: "full-points-km",
    label: "Full points within",
    description: "Pins within this many kilometres earn full points.",
    value: { type: "number", min: 0 },
    builtin: 0.025,
    kinds: ["map"],
  },
  {
    key: "one-point-km",
    label: "One point at",
    description: "Distance in kilometres at which a pin earns exactly one point.",
    value: { type: "number", min: 0 },
    builtin: 10000,
    kinds: ["map"],
  },
];

export const SETTING_KEYS: SettingKey[] = SETTINGS.map((s) => s.key);

const BY_KEY = new Map<string, SettingDef>(SETTINGS.map((s) => [s.key, s]));

export function settingDef(key: SettingKey): SettingDef {
  return BY_KEY.get(key)!;
}

export function isSettingKey(key: string): key is SettingKey {
  return BY_KEY.has(key);
}

const PERCENT = /^\d+(\.\d+)?%$/;

/**
 * Check a declared value against its definition. Returns the value to use, or
 * `undefined` with a plain-words reason when it is not acceptable.
 */
export function checkSettingValue(
  key: SettingKey,
  raw: unknown
): { ok: true; value: SettingValue } | { ok: false; reason: string } {
  const def = settingDef(key);
  const t = def.value;
  switch (t.type) {
    case "enum":
      if (typeof raw === "string" && t.values.includes(raw))
        return { ok: true, value: raw };
      return {
        ok: false,
        reason: `\`${key}\` must be one of ${t.values.join(", ")}.`,
      };
    case "integer":
      if (typeof raw === "number" && Number.isInteger(raw) && raw >= t.min)
        return { ok: true, value: raw };
      return {
        ok: false,
        reason: `\`${key}\` must be a whole number of at least ${t.min}.`,
      };
    case "number":
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= t.min)
        return { ok: true, value: raw };
      return {
        ok: false,
        reason: `\`${key}\` must be a number of at least ${t.min}.`,
      };
    case "boolean":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      return { ok: false, reason: `\`${key}\` must be true or false.` };
    case "range":
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0)
        return { ok: true, value: raw };
      if (typeof raw === "string" && PERCENT.test(raw.trim()))
        return { ok: true, value: raw.trim() };
      return {
        ok: false,
        reason: `\`${key}\` must be a number or a percentage such as 10%.`,
      };
  }
}

/** A declared `within` split into what the game needs. */
export function parseWithin(value: SettingValue): {
  type: "absolute" | "percent";
  value: number;
} {
  if (typeof value === "string" && value.endsWith("%")) {
    return { type: "percent", value: parseFloat(value) };
  }
  return { type: "absolute", value: Number(value) };
}

/** Short human-readable form of a setting value, for the inspector and badges. */
export function formatSetting(key: SettingKey, value: SettingValue): string {
  switch (key) {
    case "kind":
      return KIND_LABELS[value as Kind] ?? String(value);
    case "timer":
      return `${value}s`;
    case "speed-bonus":
      return value ? "On" : "Off";
    case "within":
      return `±${value}`;
    case "full-points-km":
    case "one-point-km":
      return `${value} km`;
    default:
      return String(value);
  }
}
