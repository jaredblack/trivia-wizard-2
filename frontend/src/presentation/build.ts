// Pure renderer for hosted presentations. Mirrors slider/build.js but uses
// pre-fetched manifests instead of fs.readdirSync, and pre-fetched custom-slide
// HTML instead of fs.readFileSync — the renderer itself does no I/O.

interface ImageRef {
  url: string;
  reveal?: string;
  position?: string;
}
type ImageEntry = string | ImageRef;

interface BaseSlide {
  notes?: string;
}
interface CategorySlide extends BaseSlide {
  type: 'category';
  title: string;
  subtitle?: string;
  images?: ImageEntry[];
}
interface QuestionSlide extends BaseSlide {
  type: 'question';
  id: string;
  question: string;
  answer?: string;
  choices?: string[];
  matching?: { left: string[]; right: string[] };
  images?: ImageRef[];
}
interface ImageSlide extends BaseSlide {
  type: 'image';
  title?: string;
  image: string;
}
interface CustomSlide extends BaseSlide {
  type: 'custom';
  file?: string;
  html?: string;
}
type Slide = CategorySlide | QuestionSlide | ImageSlide | CustomSlide;

export interface PresentationData {
  title?: string;
  subtitle?: string;
  slides: Slide[];
}

export interface BuildContext {
  eventId: string;
  cdnBase: string;
  sharedImages: string[];
  eventImages: string[];
  customSlides: Map<string, string>;
}

export interface BuildResult {
  slidesHtml: string;
  bgUrl: string;
  questionCount: number;
}

function esc(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNotes(slide: BaseSlide): string {
  return slide.notes ? `<aside class="notes">${esc(slide.notes)}</aside>` : '';
}

// Resolve an image ref into a site-relative URL, mirroring slider/build.js.
//   - http(s)://    passthrough
//   - /<path>       passthrough
//   - ./<name>      event manifest, /cdn/events/<eventId>/images/<file>
//   - <name>        shared manifest, /cdn/images/<file>
// Match by stem (filename minus extension), case-insensitive.
function makeResolveImageUrl(ctx: BuildContext) {
  return function resolveImageUrl(ref: string): string {
    if (!ref) return ref;
    if (/^https?:\/\//i.test(ref)) return ref;
    if (ref.startsWith('/')) return ref;

    let manifest: string[];
    let urlBase: string;
    let needle: string;
    if (ref.startsWith('./')) {
      manifest = ctx.eventImages;
      urlBase = `${ctx.cdnBase}/events/${ctx.eventId}/images`;
      needle = ref.slice(2).toLowerCase();
    } else {
      manifest = ctx.sharedImages;
      urlBase = `${ctx.cdnBase}/images`;
      needle = ref.toLowerCase();
    }

    const matches = manifest.filter(
      (f) => f.replace(/\.[^.]+$/, '').toLowerCase() === needle
    );
    if (matches.length === 0) {
      throw new Error(`No image found for "${ref}" in ${urlBase}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple images match "${ref}" in ${urlBase}: ${matches.join(', ')}`
      );
    }
    return `${urlBase}/${matches[0]}`;
  };
}

// Resolve a custom-slide `file:` ref into a site-relative URL the page can fetch.
//   - http(s)://   rejected (matches slider/build.js)
//   - /<path>      passthrough
//   - ./<path>     /cdn/events/<eventId>/<path>
//   - <path>       /cdn/<path>
// `..` segments are rejected to keep refs inside the bucket boundary.
export function resolveCustomFileUrl(
  ref: string,
  ctx: { cdnBase: string; eventId: string }
): string {
  if (/^https?:\/\//i.test(ref)) {
    throw new Error(
      `Custom slide \`file: ${ref}\`: http(s) refs aren't supported.`
    );
  }
  if (ref.startsWith('/')) return ref;

  const stripped = ref.startsWith('./') ? ref.slice(2) : ref;
  const segments = stripped.split('/');
  if (segments.some((s) => s === '..')) {
    throw new Error(
      `Custom slide path "${ref}" contains '..' which escapes the bucket boundary.`
    );
  }
  const cleanPath = segments.join('/');
  return ref.startsWith('./')
    ? `${ctx.cdnBase}/events/${ctx.eventId}/${cleanPath}`
    : `${ctx.cdnBase}/${cleanPath}`;
}

// Walk the deck and return every custom-slide `file:` ref. Used by the page to
// pre-fetch HTML before rendering — the renderer is sync.
export function collectCustomFileRefs(data: PresentationData): string[] {
  const refs: string[] = [];
  for (const s of data.slides ?? []) {
    if (s.type === 'custom' && s.file) refs.push(s.file);
  }
  return refs;
}

// — Title slide —
function renderTitle(data: PresentationData): string {
  return `
      <section class="title-slide">
        <h1 class="title">${esc(data.title || 'Trivia Night')}</h1>
        ${data.subtitle ? `<p class="subtitle">${esc(data.subtitle)}</p>` : ''}
      </section>`;
}

// — Category slide —
function renderCategory(
  slide: CategorySlide,
  resolveImageUrl: (ref: string) => string
): string {
  const imgs =
    slide.images && slide.images.length
      ? `<div class="category-images">${slide.images
          .map((img) => {
            const ref = typeof img === 'string' ? img : img.url;
            return `<img src="${resolveImageUrl(ref)}" class="category-image">`;
          })
          .join('')}</div>`
      : '';

  return `
      <section class="category-slide">
        <h1 class="category-title">${esc(slide.title)}</h1>
        ${slide.subtitle ? `<p class="category-subtitle">${esc(slide.subtitle)}</p>` : ''}
        ${imgs}
        ${renderNotes(slide)}
      </section>`;
}

// — Question slide —
function renderQuestion(
  slide: QuestionSlide,
  num: number,
  resolveImageUrl: (ref: string) => string
): string {
  const hasChoices = Array.isArray(slide.choices) && slide.choices.length > 0;
  const hasMatching = !!slide.matching;
  const images = Array.isArray(slide.images) ? slide.images : [];
  const sideImages = images.filter((i) => (i.position || 'side') === 'side');
  const centerImages = images.filter((i) => i.position === 'center');
  const qSide = sideImages.filter((i) => (i.reveal || 'question') === 'question');
  const aSide = sideImages.filter((i) => i.reveal === 'answer');
  const qCenter = centerImages.filter((i) => (i.reveal || 'question') === 'question');
  const aCenter = centerImages.filter((i) => i.reveal === 'answer');
  const hasSideImages = qSide.length > 0 || aSide.length > 0;
  const hasCenterImages = qCenter.length > 0 || aCenter.length > 0;

  let layout = 'layout-freeresponse';
  if (hasChoices) layout = 'layout-multichoice';
  if (hasMatching) layout = 'layout-matching';
  if (hasSideImages) layout += ' has-images';
  if (hasCenterImages) layout += ' has-hero-image';

  let content = `<p class="question-text">Q: ${slide.question.trim()}</p>`;

  if (hasChoices && slide.choices) {
    content += `<ol class="choices" type="A">${slide.choices
      .map((c) => `<li>${esc(c)}</li>`)
      .join('')}</ol>`;
  }

  if (hasMatching && slide.matching) {
    content += `
      <div class="matching-columns">
        <ol class="matching-left">${slide.matching.left
          .map((x) => `<li>${esc(x)}</li>`)
          .join('')}</ol>
        <ol class="matching-right" type="A">${slide.matching.right
          .map((x) => `<li>${esc(x)}</li>`)
          .join('')}</ol>
      </div>`;
  }

  let imageCol = '';
  if (hasSideImages) {
    const isSwap = qSide.length > 0 && aSide.length > 0;
    const containerClass = isSwap
      ? 'question-images-col side-swap'
      : 'question-images-col';
    const qImgs = qSide
      .map((i) => {
        const cls = isSwap ? 'slide-image fragment fade-out' : 'slide-image';
        const idx = isSwap ? ' data-fragment-index="1"' : '';
        return `<img src="${resolveImageUrl(i.url)}" class="${cls}"${idx}>`;
      })
      .join('');
    const aImgs = aSide
      .map(
        (i) =>
          `<img src="${resolveImageUrl(i.url)}" class="slide-image fragment" data-fragment-index="1">`
      )
      .join('');
    imageCol = `<div class="${containerClass}">${qImgs}${aImgs}</div>`;
  }

  let heroImgs = '';
  if (hasCenterImages) {
    const isSwap = qCenter.length > 0 && aCenter.length > 0;
    const containerClass = isSwap
      ? 'question-hero-images hero-swap'
      : 'question-hero-images';
    const qHero = qCenter
      .map((i) => {
        const cls = isSwap ? 'hero-image fragment fade-out' : 'hero-image';
        const idx = isSwap ? ' data-fragment-index="1"' : '';
        return `<img src="${resolveImageUrl(i.url)}" class="${cls}"${idx}>`;
      })
      .join('');
    const aHero = aCenter
      .map(
        (i) =>
          `<img src="${resolveImageUrl(i.url)}" class="hero-image fragment" data-fragment-index="1">`
      )
      .join('');
    heroImgs = `<div class="${containerClass}">${qHero}${aHero}</div>`;
  }

  const answer = slide.answer
    ? `<p class="fragment answer" data-fragment-index="1">A: ${slide.answer}</p>`
    : '';

  return `
      <section class="question-slide ${layout}">
        <h2 class="question-number">Question ${num}</h2>
        <div class="question-body">
          <div class="question-content">${content}</div>
          ${imageCol}
        </div>
        ${heroImgs}
        ${answer}
        ${renderNotes(slide)}
      </section>`;
}

// — Image slide —
function renderImageSlide(
  slide: ImageSlide,
  resolveImageUrl: (ref: string) => string
): string {
  const img = slide.image
    ? `<img src="${resolveImageUrl(slide.image)}" class="image-slide-image">`
    : '';
  return `
      <section class="image-slide">
        ${slide.title ? `<h1 class="image-slide-title">${esc(slide.title)}</h1>` : ''}
        <div class="image-slide-image-wrap">${img}</div>
        ${renderNotes(slide)}
      </section>`;
}

// — Custom slide —
function renderCustom(slide: CustomSlide, customSlides: Map<string, string>): string {
  let inner = '';
  if (slide.file) {
    const html = customSlides.get(slide.file);
    if (html === undefined) {
      throw new Error(`Custom slide content not preloaded for "${slide.file}"`);
    }
    inner = html;
  } else if (slide.html) {
    inner = slide.html;
  }
  return `
      <section class="custom-slide">
        ${inner}
      </section>`;
}

// Render the inner slides HTML for injection into `.reveal > .slides`.
// Question numbers are assigned by unique id; repeat ids reuse the same number.
export function renderSlides(data: PresentationData, ctx: BuildContext): BuildResult {
  const resolveImageUrl = makeResolveImageUrl(ctx);
  const bgUrl = resolveImageUrl('bg');

  const numberByID = new Map<string, number>();
  const parts: string[] = [renderTitle(data)];

  for (const s of data.slides ?? []) {
    if (s.type === 'question') {
      if (!s.id) {
        throw new Error(
          `Question is missing required 'id' field: ${JSON.stringify(s.question)}`
        );
      }
      const idKey = String(s.id).toLowerCase();
      let num = numberByID.get(idKey);
      if (num === undefined) {
        num = numberByID.size + 1;
        numberByID.set(idKey, num);
      }
      parts.push(renderQuestion(s, num, resolveImageUrl));
    } else if (s.type === 'category') {
      parts.push(renderCategory(s, resolveImageUrl));
    } else if (s.type === 'image') {
      parts.push(renderImageSlide(s, resolveImageUrl));
    } else if (s.type === 'custom') {
      parts.push(renderCustom(s, ctx.customSlides));
    }
  }

  return {
    slidesHtml: parts.filter(Boolean).join('\n'),
    bgUrl,
    questionCount: numberByID.size,
  };
}
