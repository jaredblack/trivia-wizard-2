// Pure slide renderer: compiled deck in, reveal.js section HTML out. No I/O —
// image manifests and custom-slide HTML are fetched by the caller.

import { resolveImage, type ImageContext } from "../deck/images";
import type {
  CategorySlide,
  CompiledDeck,
  CustomSlide,
  DeckSlide,
  ImageSlide,
  QuestionSlide,
  TitleSlide,
} from "../deck/types";

/** Shared image shown on the join slide. */
export const JOIN_QR_IMAGE = "trivia-wizard-join-qr";
/** Shared image used as the deck background. */
export const BACKGROUND_IMAGE = "bg";

export interface RenderContext extends ImageContext {
  /** Custom-slide HTML keyed by the `file:` ref as written in the deck. */
  customSlides: Map<string, string>;
  /** Shown on the join slide when the deck is attached to a live game. */
  gameCode?: string;
}

export interface RenderResult {
  slidesHtml: string;
  /** One HTML string per entry in `deck.slides`. */
  sections: string[];
  bgUrl: string | null;
  questionCount: number;
  /** Image names that matched nothing, in deck order. */
  missingImages: string[];
}

function esc(str: unknown): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNotes(slide: DeckSlide): string {
  return slide.notes ? `<aside class="notes">${esc(slide.notes)}</aside>` : "";
}

// Resolve a custom-slide `file:` ref into a site-relative URL the page can fetch.
//   - http(s)://   rejected
//   - /<path>      passthrough
//   - ./<path>     <eventBase>/<path>
//   - <path>       <cdnBase>/<path>
// `..` segments are rejected to keep refs inside the bucket boundary.
export function resolveCustomFileUrl(
  ref: string,
  ctx: { cdnBase: string; eventBase: string }
): string {
  if (/^https?:\/\//i.test(ref)) {
    throw new Error(`Custom slide \`file: ${ref}\`: http(s) refs aren't supported.`);
  }
  if (ref.startsWith("/")) return ref;

  const stripped = ref.startsWith("./") ? ref.slice(2) : ref;
  const segments = stripped.split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error(
      `Custom slide path "${ref}" contains '..' which escapes the bucket boundary.`
    );
  }
  const cleanPath = segments.join("/");
  return ref.startsWith("./")
    ? `${ctx.eventBase}/${cleanPath}`
    : `${ctx.cdnBase}/${cleanPath}`;
}

/** Every custom-slide `file:` ref, so the page can pre-fetch before rendering. */
export function collectCustomFileRefs(deck: CompiledDeck): string[] {
  const refs: string[] = [];
  for (const s of deck.slides) {
    if (s.type === "custom" && s.file) refs.push(s.file);
  }
  return refs;
}

type ImgTag = (ref: string, cls: string, attrs?: string) => string;

function makeImgTag(ctx: RenderContext, missing: string[]): ImgTag {
  return (ref, cls, attrs = "") => {
    const r = resolveImage(ref, ctx);
    if (!r.found) {
      missing.push(ref);
      // A visible stand-in beats failing the whole deck for one bad name.
      return `<div class="${cls} missing-image"${attrs}>Image not found: ${esc(ref)}</div>`;
    }
    return `<img src="${esc(r.url)}" class="${cls}"${attrs}>`;
  };
}

function renderTitle(slide: TitleSlide): string {
  return `
      <section class="title-slide">
        <h1 class="title">${esc(slide.title)}</h1>
        ${slide.subtitle ? `<p class="subtitle">${esc(slide.subtitle)}</p>` : ""}
      </section>`;
}

function renderJoin(slide: DeckSlide, ctx: RenderContext, img: ImgTag): string {
  const code = ctx.gameCode ? esc(ctx.gameCode) : "&middot;&middot;&middot;&middot;";
  return `
      <section class="image-slide join-slide">
        <h1 class="image-slide-title">One person from each team:
Join the game on Trivia Wizard
Game code: <span class="join-code" data-game-code>${code}</span></h1>
        <div class="image-slide-image-wrap">${img(JOIN_QR_IMAGE, "image-slide-image")}</div>
        ${renderNotes(slide)}
      </section>`;
}

function renderCategory(slide: CategorySlide, img: ImgTag): string {
  const imgs = slide.images.length
    ? `<div class="category-images">${slide.images
        .map((ref) => img(ref, "category-image"))
        .join("")}</div>`
    : "";
  return `
      <section class="category-slide">
        <h1 class="category-title">${esc(slide.title)}</h1>
        ${slide.subtitle ? `<p class="category-subtitle">${esc(slide.subtitle)}</p>` : ""}
        ${imgs}
        ${renderNotes(slide)}
      </section>`;
}

// Question text keeps its source line structure: a blank line starts a new
// paragraph, a single newline is a hard break. Inline markup in the source is
// passed through unescaped, as it always has been.
function renderQuestionText(raw: string): string {
  const paragraphs = raw
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim().replace(/\n/g, "<br>"))
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return `<p class="question-text">Q: ${paragraphs[0] ?? ""}</p>`;
  }
  const [first, ...rest] = paragraphs;
  return `<div class="question-text"><p>Q: ${first}</p>${rest
    .map((p) => `<p>${p}</p>`)
    .join("")}</div>`;
}

// Images that appear with the question and with the answer share one slot:
// when both exist the answer image takes the question image's place on reveal.
function renderImageSlot(
  slide: QuestionSlide,
  img: ImgTag,
  containerCls: string,
  swapCls: string,
  imgCls: string
): string {
  const { images, answerImages } = slide;
  if (!images.length && !answerImages.length) return "";
  const isSwap = images.length > 0 && answerImages.length > 0;
  const q = images
    .map((ref) =>
      isSwap
        ? img(ref, `${imgCls} fragment fade-out`, ' data-fragment-index="1"')
        : img(ref, imgCls)
    )
    .join("");
  const a = answerImages
    .map((ref) => img(ref, `${imgCls} fragment`, ' data-fragment-index="1"'))
    .join("");
  return `<div class="${containerCls}${isSwap ? ` ${swapCls}` : ""}">${q}${a}</div>`;
}

function renderQuestion(slide: QuestionSlide, img: ImgTag): string {
  const hasChoices = !!slide.choices?.length;
  const hasImages = slide.images.length > 0 || slide.answerImages.length > 0;
  const hero = slide.layout === "hero";

  let layout = "layout-freeresponse";
  if (hasChoices) layout = "layout-multichoice";
  if (slide.matching) layout = "layout-matching";
  if (hasImages) layout += hero ? " has-hero-image" : " has-images";

  let content = renderQuestionText(slide.text);

  if (hasChoices && slide.choices) {
    const labels = slide.choiceLabels;
    const choiceList = (cls: string, attrs = "") =>
      `<ol class="${cls}"${attrs}>${slide.choices!
        .map((c, i) => {
          const label = labels?.[i];
          const marker = label
            ? ` style="list-style-type: '${esc(label.replace(/['\\]/g, ""))}. '"`
            : "";
          return `<li${marker}>${esc(c)}</li>`;
        })
        .join("")}</ol>`;
    if (slide.answerList) {
      // Ranking: the ordered answer takes the place of the choices on reveal.
      content += `<div class="choices-swap">${choiceList(
        "choices fragment fade-out",
        ' data-fragment-index="1"'
      )}<ol class="choices answer-list fragment" data-fragment-index="1">${slide.answerList
        .map((c) => `<li>${esc(c)}</li>`)
        .join("")}</ol></div>`;
    } else {
      content += choiceList("choices");
    }
  }

  if (slide.matching) {
    content += `
      <div class="matching-columns">
        <ol class="matching-left">${slide.matching.left
          .map((x) => `<li>${esc(x)}</li>`)
          .join("")}</ol>
        <ol class="matching-right" type="A">${slide.matching.right
          .map((x) => `<li>${esc(x)}</li>`)
          .join("")}</ol>
      </div>`;
  }

  const imageCol = hero
    ? ""
    : renderImageSlot(slide, img, "question-images-col", "side-swap", "slide-image");
  const heroImgs = hero
    ? renderImageSlot(slide, img, "question-hero-images", "hero-swap", "hero-image")
    : "";

  const answer =
    slide.answerText !== undefined
      ? `<p class="fragment answer" data-fragment-index="1">A: ${slide.answerText}</p>`
      : "";

  return `
      <section class="question-slide ${layout}" data-question="${slide.questionNumber}">
        <h2 class="question-number">Question ${slide.questionNumber}</h2>
        <div class="question-body">
          <div class="question-content">${content}</div>
          ${imageCol}
        </div>
        ${heroImgs}
        ${answer}
        ${renderNotes(slide)}
      </section>`;
}

function renderImageSlide(slide: ImageSlide, img: ImgTag): string {
  return `
      <section class="image-slide">
        ${slide.title ? `<h1 class="image-slide-title">${esc(slide.title)}</h1>` : ""}
        <div class="image-slide-image-wrap">${
          slide.image ? img(slide.image, "image-slide-image") : ""
        }</div>
        ${renderNotes(slide)}
      </section>`;
}

function renderCustom(slide: CustomSlide, customSlides: Map<string, string>): string {
  let inner = "";
  if (slide.file) {
    const html = customSlides.get(slide.file);
    inner =
      html ??
      `<p class="missing-image">Custom slide file not loaded: ${esc(slide.file)}</p>`;
  } else if (slide.html) {
    inner = slide.html;
  }
  return `
      <section class="custom-slide">
        ${inner}
      </section>`;
}

function renderOne(slide: DeckSlide, ctx: RenderContext, img: ImgTag): string {
  switch (slide.type) {
    case "title":
      return renderTitle(slide);
    case "join":
      return renderJoin(slide, ctx, img);
    case "category":
      return renderCategory(slide, img);
    case "question":
      return renderQuestion(slide, img);
    case "image":
      return renderImageSlide(slide, img);
    case "custom":
      return renderCustom(slide, ctx.customSlides);
  }
}

/** Render a single slide, e.g. for the editor's preview. */
export function renderSlide(slide: DeckSlide, ctx: RenderContext): string {
  return renderOne(slide, ctx, makeImgTag(ctx, []));
}

export function backgroundUrl(ctx: ImageContext): string | null {
  const bg = resolveImage(BACKGROUND_IMAGE, { ...ctx, eventImages: [] });
  return bg.found ? bg.url : null;
}

/** Render every slide for injection into `.reveal > .slides`. */
export function renderDeck(deck: CompiledDeck, ctx: RenderContext): RenderResult {
  const missing: string[] = [];
  const img = makeImgTag(ctx, missing);
  const sections = deck.slides.map((s) => renderOne(s, ctx, img));
  return {
    slidesHtml: sections.join("\n"),
    sections,
    bgUrl: backgroundUrl(ctx),
    questionCount: deck.questions.length,
    missingImages: missing,
  };
}
