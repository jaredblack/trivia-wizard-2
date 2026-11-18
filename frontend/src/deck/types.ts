import type { Kind, SettingKey, SettingValue } from "./settings";

/** Where an effective setting value came from. */
export type SettingSource =
  | "question"
  | "category"
  | "deck"
  /** Inferred from the question itself, e.g. `choices` implying multiple-choice. */
  | "implied"
  | "builtin";

export interface ResolvedSetting {
  value: SettingValue;
  source: SettingSource;
}

export type ResolvedSettings = Record<SettingKey, ResolvedSetting>;
export type DeclaredSettings = Partial<Record<SettingKey, SettingValue>>;

/** 1-based line span of one item in the source text. */
export interface LineRange {
  startLine: number;
  /** Last line holding the item's own content. */
  contentEndLine: number;
  /** Last line before the next item starts (trailing blanks and comments). */
  endLine: number;
}

/** One image reference in the source text, with where it sits. */
export interface ImageRef {
  ref: string;
  when: "question" | "answer";
  line: number;
  /** 1-based columns, end exclusive. */
  col: number;
  endCol: number;
}

export interface Problem {
  severity: "error" | "warning";
  message: string;
  line?: number;
}

interface SlideBase {
  notes?: string;
  /** Absent for the generated title slide. */
  range?: LineRange;
  /** Position in the YAML `slides:` list. Absent for the generated title slide. */
  itemIndex?: number;
}

export interface TitleSlide extends SlideBase {
  type: "title";
  title: string;
  subtitle?: string;
}

export interface JoinSlide extends SlideBase {
  type: "join";
}

export interface CategorySlide extends SlideBase {
  type: "category";
  title: string;
  subtitle?: string;
  images: string[];
  /** Index into `CompiledDeck.categories`. */
  categoryIndex: number;
}

export interface QuestionSlide extends SlideBase {
  type: "question";
  /** 1-based question number shown on the slide. */
  questionNumber: number;
  /** `main` is the `q:` slide; `then` is a follow-up slide of the same question. */
  part: "main" | "then";
  text: string;
  /** Shown as the "A:" line on reveal. */
  answerText?: string;
  /** Replaces the choices list on reveal (ranking questions). */
  answerList?: string[];
  choices?: string[];
  matching?: { left: string[]; right: string[] };
  images: string[];
  answerImages: string[];
  layout: "side" | "hero";
  /** True when advancing on this slide reveals something before moving on. */
  hasReveal: boolean;
}

export interface ImageSlide extends SlideBase {
  type: "image";
  title?: string;
  image?: string;
}

export interface CustomSlide extends SlideBase {
  type: "custom";
  file?: string;
  html?: string;
}

export type DeckSlide =
  | TitleSlide
  | JoinSlide
  | CategorySlide
  | QuestionSlide
  | ImageSlide
  | CustomSlide;

export interface DeckCategory {
  title: string;
  declared: DeclaredSettings;
  range: LineRange;
  /** Numbers of the questions that inherit from this category. */
  questionNumbers: number[];
}

export interface DeckQuestion {
  number: number;
  text: string;
  /** The answer as written, across the question's slides. */
  answer?: string | number | (string | number)[];
  choices?: string[];
  /** Map questions: [lat, lng]. */
  location?: [number, number];
  kind: Kind;
  settings: ResolvedSettings;
  declared: DeclaredSettings;
  /** Index into `CompiledDeck.categories`, when the question sits under one. */
  categoryIndex?: number;
  /** Indexes into `CompiledDeck.slides`, the `q:` slide first. */
  slideIndexes: number[];
  /** Span of the `q:` item alone. */
  range: LineRange;
}

export interface CompiledDeck {
  title: string;
  subtitle?: string;
  defaults: DeclaredSettings;
  /** Line of the `defaults:` key, when present. */
  defaultsLine?: number;
  /** Line of the `slides:` key, when present. */
  slidesLine?: number;
  /** The generated title slide is always first. */
  slides: DeckSlide[];
  questions: DeckQuestion[];
  categories: DeckCategory[];
  images: ImageRef[];
  problems: Problem[];
  /** The source was in the old `type:`/`id:` format and was converted in memory. */
  legacy: boolean;
}
