import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { matchChoice, slideIndexAtLine } from "../../../deck/compile";
import {
  addToList,
  removeFromList,
  setKey,
  type EditTarget,
  type EditValue,
  type LineEdit,
} from "../../../deck/edit";
import { missingImages, resolveImage, type ImageContext } from "../../../deck/images";
import {
  KIND_LABELS,
  checkSettingValue,
  settingDef,
  type Kind,
  type SettingDef,
  type SettingKey,
  type SettingValue,
} from "../../../deck/settings";
import { resolveLevel, settingKeysFor } from "../../../deck/summary";
import type {
  CompiledDeck,
  DeckSlide,
  Problem,
  ResolvedSetting,
  SettingSource,
} from "../../../deck/types";
import type { RenderContext } from "../../../presentation/render";
import SlidePreview from "./SlidePreview";

const LocationPicker = lazy(() => import("./LocationPicker"));

const MAPS_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
const TEST_MODE = import.meta.env.VITE_TEST_MODE === "true";

export interface InspectorProps {
  deck: CompiledDeck | null;
  /** 1-based line the editor cursor is on. */
  cursorLine: number;
  imageCtx: ImageContext | null;
  /** Apply an edit computed from the editor's current text. */
  runEdit: (compute: (text: string) => LineEdit | null) => void;
  /** Upload a file and attach it to the slide on `line`. */
  attachFile: (file: File, line: number) => void;
  jumpToLine: (line: number) => void;
}

/** Which level of the cascade the panel is editing. */
type Level = "question" | "category" | "deck";

const SOURCE_LABEL: Record<Level, Record<SettingSource, string>> = {
  question: {
    question: "this question",
    category: "category",
    deck: "deck",
    implied: "from choices",
    builtin: "built-in",
  },
  category: {
    question: "",
    category: "this category",
    deck: "deck",
    implied: "",
    builtin: "built-in",
  },
  deck: {
    question: "",
    category: "",
    deck: "this deck",
    implied: "",
    builtin: "built-in",
  },
};

const optionLabel = (key: SettingKey, value: string) =>
  key === "kind"
    ? KIND_LABELS[value as Kind]
    : value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, " ");

const EMPTY_CUSTOM = new Map<string, string>();

export default function Inspector(props: InspectorProps) {
  const { deck, cursorLine, imageCtx, runEdit, attachFile, jumpToLine } = props;
  const [revealed, setRevealed] = useState(false);

  const renderCtx = useMemo<RenderContext | null>(
    () => (imageCtx ? { ...imageCtx, customSlides: EMPTY_CUSTOM } : null),
    [imageCtx]
  );

  if (!deck) {
    return <Shell>Loading…</Shell>;
  }
  if (deck.legacy) {
    return (
      <Shell>
        <h2>Old format</h2>
        <p className="text-sm mt-2">
          Convert this deck to see slide previews and settings here.
        </p>
      </Shell>
    );
  }

  const slideIdx = slideIndexAtLine(deck, cursorLine);
  const slide: DeckSlide = slideIdx === -1 ? deck.slides[0] : deck.slides[slideIdx];

  let level: Level | null = null;
  let heading = "";
  let sub = "";
  let resolved: Record<SettingKey, ResolvedSetting> | null = null;
  let target: EditTarget | null = null;
  let kind: Kind = "standard";
  let hasImages = true;

  if (slideIdx === -1) {
    level = "deck";
    heading = "Deck defaults";
    sub = "Apply to every question unless a category or question says otherwise.";
    resolved = resolveLevel(deck, {}, "deck");
    target = { type: "defaults" };
    kind = resolved.kind.value as Kind;
  } else if (slide.type === "question") {
    const q = deck.questions[slide.questionNumber - 1];
    const main = deck.slides[q.slideIndexes[0]];
    level = "question";
    heading = `Question ${q.number}`;
    sub =
      (slide.part === "then" ? "Follow-up slide. " : "") +
      (q.categoryIndex !== undefined ? deck.categories[q.categoryIndex].title : "");
    resolved = q.settings;
    kind = q.kind;
    if (main.itemIndex !== undefined) target = { type: "slide", index: main.itemIndex };
    hasImages = q.slideIndexes.some((i) => {
      const s = deck.slides[i];
      return s.type === "question" && (s.images.length > 0 || s.answerImages.length > 0);
    });
  } else if (slide.type === "category") {
    const cat = deck.categories[slide.categoryIndex];
    const n = cat.questionNumbers.length;
    level = "category";
    heading = `Category: ${cat.title}`;
    sub = `Settings here apply to the ${n} question${n === 1 ? "" : "s"} below it.`;
    resolved = resolveLevel(deck, cat.declared, "category");
    kind = resolved.kind.value as Kind;
    if (slide.itemIndex !== undefined) target = { type: "slide", index: slide.itemIndex };
  } else if (slide.type === "join") {
    heading = "Join slide";
    sub = "Shows the live game code once a game is running.";
  } else if (slide.type === "image") {
    heading = "Image slide";
  } else if (slide.type === "custom") {
    heading = "Custom slide";
    sub = slide.file ? "Loaded from a file when presenting." : "";
  }

  const question =
    slide.type === "question" && slideIdx !== -1
      ? deck.questions[slide.questionNumber - 1]
      : null;
  const slideTarget: EditTarget | null =
    slideIdx !== -1 && slide.itemIndex !== undefined
      ? { type: "slide", index: slide.itemIndex }
      : null;

  const values: Partial<Record<SettingKey, SettingValue>> = {};
  if (resolved) {
    for (const [k, r] of Object.entries(resolved)) values[k as SettingKey] = r.value;
  }
  const keys = resolved ? settingKeysFor(kind, values, hasImages) : [];

  const problems: Problem[] = [
    ...deck.problems,
    ...(imageCtx
      ? missingImages(deck.images, imageCtx).map(
          (img): Problem => ({
            severity: "warning",
            message: `No image called "${img.ref}" in this event or the shared images.`,
            line: img.line,
          })
        )
      : []),
  ].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  const canReveal = slide.type === "question" && slide.hasReveal;

  return (
    <Shell>
      <div className="flex items-baseline justify-between gap-2">
        <h2 data-testid="inspector-heading">{heading}</h2>
        {canReveal && (
          <div className="text-xs flex gap-2" role="group" aria-label="Preview state">
            <button
              type="button"
              className={`cursor-pointer ${revealed ? "" : "font-semibold underline"}`}
              onClick={() => setRevealed(false)}
            >
              Question
            </button>
            <button
              type="button"
              className={`cursor-pointer ${revealed ? "font-semibold underline" : ""}`}
              onClick={() => setRevealed(true)}
            >
              Answer
            </button>
          </div>
        )}
      </div>
      {sub && <p className="text-xs text-stone-600 mt-0.5">{sub}</p>}

      <div className="mt-2">
        {renderCtx && (
          <SlidePreview slide={slide} ctx={renderCtx} revealed={canReveal && revealed} />
        )}
      </div>

      {resolved && level && target && (
        <section className="mt-3" data-testid="inspector-settings">
          <h3>Settings</h3>
          {keys.map((key) => (
            <SettingRow
              key={key}
              def={settingDef(key)}
              resolved={resolved[key]}
              level={level}
              onChange={(value) => runEdit((text) => setKey(text, target, key, value))}
              onReset={() => runEdit((text) => setKey(text, target, key, undefined))}
            />
          ))}
          {question && (
            <AnswerRow
              answer={question.answer}
              choices={kind === "multiple-choice" ? question.choices : undefined}
              optionType={String(values.options)}
              onPick={(choice) => runEdit((text) => setKey(text, target, "a", choice))}
            />
          )}
          {question && kind === "map" && (
            <LocationRow
              location={question.location}
              onChange={(loc) =>
                runEdit((text) => setKey(text, target, "location", loc, "flow"))
              }
            />
          )}
        </section>
      )}

      {slideTarget && imageCtx && (slide.type === "question" || slide.type === "category" || slide.type === "image") && (
        <ImagesSection
          slide={slide}
          ctx={imageCtx}
          onMove={(ref, to) => {
            const from = to === "image" ? "answer-image" : "image";
            runEdit((text) => removeFromList(text, slideTarget, from, ref));
            runEdit((text) => addToList(text, slideTarget, to, ref));
          }}
          onRemove={(ref, from) =>
            runEdit((text) =>
              slide.type === "image"
                ? null
                : removeFromList(text, slideTarget, from, ref)
            )
          }
          onFile={(file) => attachFile(file, slide.range?.startLine ?? cursorLine)}
        />
      )}

      <section className="mt-4" data-testid="inspector-problems">
        <h3>{problems.length ? `Problems (${problems.length})` : "No problems"}</h3>
        <ul className="mt-1 space-y-1">
          {problems.slice(0, 12).map((p, i) => (
            // The size sits on the item: a global stylesheet makes buttons
            // inherit their font, which overrides size utilities on them.
            <li key={i} className="text-xs">
              <button
                type="button"
                onClick={() => p.line && jumpToLine(p.line)}
                className={`text-left cursor-pointer hover:underline ${
                  p.severity === "error" ? "text-red-800" : "text-amber-800"
                }`}
              >
                {p.message}
              </button>
            </li>
          ))}
          {problems.length > 12 && (
            <li className="text-xs text-stone-600">and {problems.length - 12} more</li>
          )}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <aside
      className="inspector w-[400px] shrink-0 overflow-y-auto p-3"
      data-testid="inspector"
      aria-label="Inspector"
    >
      {children}
    </aside>
  );
}

function SourcePill({
  source,
  level,
  onReset,
  label,
}: {
  source: SettingSource;
  level: Level;
  onReset?: () => void;
  label: string;
}) {
  const own = source === level;
  return (
    <span className={`inspector-source ${own ? "own" : ""}`}>
      {SOURCE_LABEL[level][source]}
      {own && onReset && (
        <button type="button" onClick={onReset} aria-label={`Reset ${label}`} title="Remove this line">
          ×
        </button>
      )}
    </span>
  );
}

function SettingRow({
  def,
  resolved,
  level,
  onChange,
  onReset,
}: {
  def: SettingDef;
  resolved: ResolvedSetting;
  level: Level;
  onChange: (value: EditValue) => void;
  onReset: () => void;
}) {
  const id = `inspector-${def.key}`;
  const t = def.value;
  let control: React.ReactNode;

  if (t.type === "enum") {
    control = (
      <select
        id={id}
        className="inspector-control"
        value={String(resolved.value)}
        onChange={(e) => onChange(e.target.value)}
      >
        {t.values.map((v) => (
          <option key={v} value={v}>
            {optionLabel(def.key, v)}
          </option>
        ))}
      </select>
    );
  } else if (t.type === "boolean") {
    control = (
      <select
        id={id}
        className="inspector-control"
        value={resolved.value ? "on" : "off"}
        onChange={(e) => onChange(e.target.value === "on")}
      >
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    );
  } else {
    control = (
      <DraftInput
        // Remount when the value changes underneath, e.g. after an undo.
        key={String(resolved.value)}
        id={id}
        initial={String(resolved.value)}
        numeric={t.type !== "range"}
        commit={(raw) => {
          const trimmed = raw.trim();
          const parsed: unknown =
            t.type === "range" && trimmed.endsWith("%") ? trimmed : Number(trimmed);
          if (trimmed === "") return false;
          const checked = checkSettingValue(def.key, parsed);
          if (!checked.ok) return false;
          if (checked.value !== resolved.value) onChange(checked.value as EditValue);
          return true;
        }}
      />
    );
  }

  return (
    <div className="inspector-row" title={def.description}>
      <label htmlFor={id}>{def.label}</label>
      {control}
      <SourcePill source={resolved.source} level={level} onReset={onReset} label={def.label} />
    </div>
  );
}

/** A text box that writes on Enter or blur and flags values it can't accept. */
function DraftInput({
  id,
  initial,
  numeric,
  commit,
}: {
  id: string;
  initial: string;
  numeric: boolean;
  commit: (raw: string) => boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const submit = () => setInvalid(draft !== initial && !commit(draft));
  return (
    <input
      id={id}
      className={`inspector-control ${invalid ? "invalid" : ""}`}
      inputMode={numeric ? "decimal" : "text"}
      value={draft}
      aria-invalid={invalid}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") {
          setDraft(initial);
          setInvalid(false);
        }
      }}
    />
  );
}

function AnswerRow({
  answer,
  choices,
  optionType,
  onPick,
}: {
  answer: string | number | (string | number)[] | undefined;
  choices: string[] | undefined;
  optionType: string;
  onPick: (choice: string) => void;
}) {
  const shown =
    answer === undefined ? "" : Array.isArray(answer) ? answer.join(", ") : String(answer);
  if (choices && !Array.isArray(answer)) {
    const idx = matchChoice(answer, choices, optionType);
    return (
      <div className="inspector-row">
        <label htmlFor="inspector-answer">Answer</label>
        <select
          id="inspector-answer"
          className="inspector-control"
          value={idx === -1 ? "" : String(idx)}
          onChange={(e) => {
            if (e.target.value !== "") onPick(choices[Number(e.target.value)]);
          }}
        >
          <option value="">{shown ? `${shown} (not a choice)` : "Not set"}</option>
          {choices.map((c, i) => (
            <option key={i} value={i}>
              {String.fromCharCode(65 + i)}. {c}
            </option>
          ))}
        </select>
        <span />
      </div>
    );
  }
  return (
    <div className="inspector-row">
      <span className="text-[#6b5a47]">Answer</span>
      <span className={`truncate ${shown ? "" : "text-stone-500"}`} title={shown}>
        {shown || "Not set"}
      </span>
      <span />
    </div>
  );
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

function LocationRow({
  location,
  onChange,
}: {
  location: [number, number] | undefined;
  onChange: (loc: [number, number] | undefined) => void;
}) {
  const [picking, setPicking] = useState(false);
  const text = location ? `${location[0]}, ${location[1]}` : "";
  return (
    <>
      <div className="inspector-row" title="Latitude, longitude. You can paste coordinates copied from a map.">
        <label htmlFor="inspector-location">Location</label>
        <DraftInput
          key={text}
          id="inspector-location"
          initial={text}
          numeric={false}
          commit={(raw) => {
            const parts = raw.split(/[,\s]+/).filter(Boolean).map(Number);
            if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return false;
            if (Math.abs(parts[0]) > 90 || Math.abs(parts[1]) > 180) return false;
            onChange([round5(parts[0]), round5(parts[1])]);
            return true;
          }}
        />
        {location ? (
          <span className="inspector-source own">
            this question
            <button type="button" onClick={() => onChange(undefined)} aria-label="Reset Location">
              ×
            </button>
          </span>
        ) : (
          <span className="inspector-source">not set</span>
        )}
      </div>
      {MAPS_KEY && !TEST_MODE && (
        <div className="mt-1">
          <button
            type="button"
            className="text-xs underline cursor-pointer"
            onClick={() => setPicking((p) => !p)}
          >
            {picking ? "Hide map" : "Pick on a map"}
          </button>
          {picking && (
            <Suspense fallback={<p className="text-xs">Loading map…</p>}>
              <LocationPicker
                apiKey={MAPS_KEY}
                value={location}
                onPick={(loc) => onChange([round5(loc[0]), round5(loc[1])])}
              />
            </Suspense>
          )}
        </div>
      )}
    </>
  );
}

function ImagesSection({
  slide,
  ctx,
  onMove,
  onRemove,
  onFile,
}: {
  slide: DeckSlide;
  ctx: ImageContext;
  onMove: (ref: string, to: "image" | "answer-image") => void;
  onRemove: (ref: string, from: "image" | "answer-image") => void;
  onFile: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const entries: { ref: string; key: "image" | "answer-image" }[] = [];
  if (slide.type === "question") {
    slide.images.forEach((ref) => entries.push({ ref, key: "image" }));
    slide.answerImages.forEach((ref) => entries.push({ ref, key: "answer-image" }));
  } else if (slide.type === "category") {
    slide.images.forEach((ref) => entries.push({ ref, key: "image" }));
  } else if (slide.type === "image" && slide.image) {
    entries.push({ ref: slide.image, key: "image" });
  }

  return (
    <section className="mt-4" data-testid="inspector-images">
      <h3>Images</h3>
      <ul className="mt-1 space-y-1.5">
        {entries.map(({ ref, key }) => {
          const r = resolveImage(ref, ctx);
          return (
            <li key={`${key}:${ref}`} className="flex items-center gap-2 text-xs">
              {r.found ? (
                <img src={r.url} alt="" className="inspector-thumb" />
              ) : (
                <span className="inspector-thumb" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={ref}>
                  {ref}
                </span>
                {!r.found && <span className="text-red-800">not found</span>}
                {r.found && r.external && (
                  <span className="text-stone-600" title="Shown from another site; it will break if that site removes it.">
                    external link
                  </span>
                )}
              </span>
              {slide.type === "question" && (
                <select
                  className="inspector-control !w-auto"
                  aria-label={`When ${ref} appears`}
                  value={key}
                  onChange={(e) => onMove(ref, e.target.value as "image" | "answer-image")}
                >
                  <option value="image">With question</option>
                  <option value="answer-image">With answer</option>
                </select>
              )}
              {slide.type !== "image" && (
                <button
                  type="button"
                  className="underline cursor-pointer"
                  aria-label={`Remove ${ref}`}
                  onClick={() => onRemove(ref, key)}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div
        className={`inspector-dropzone mt-2 ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
          if (file) onFile(file);
        }}
      >
        Paste in the editor, drop an image here, or{" "}
        <button
          type="button"
          className="underline cursor-pointer"
          onClick={() => fileInput.current?.click()}
        >
          choose a file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          data-testid="inspector-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
