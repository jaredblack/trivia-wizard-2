// Shrink-to-fit for question slides.
//
// The CSS sizes are the *ceiling*: a question that already fits its box is left
// completely alone. Only when the text overflows do we intervene — first by
// tightening the leading, then by scaling the type down (via --q-fit) to the
// largest size that still fits.
//
// Only the current slide can be measured: reveal.js keeps the rest display:none,
// where every box measures zero. Slide geometry is a fixed 1920x1080 regardless
// of window size, so one fit per slide entry is stable.

/** Never shrink below this fraction of the declared size — past it, text on a
 *  projector is unreadable and the deck needs an edit, not a smaller font. */
const MIN_SCALE = 0.4;
/** Binary-search steps; 6 lands within ~1% of the largest fitting scale. */
const SEARCH_STEPS = 6;

function overflows(el: HTMLElement): boolean {
  // 1px slack: sub-pixel line box rounding otherwise reads as overflow.
  return el.scrollHeight - el.clientHeight > 1;
}

/**
 * Fit one question slide's text to its box. Returns the scale applied
 * (1 when the text fit as authored).
 */
export function fitQuestionSlide(slide: HTMLElement): number {
  const content = slide.querySelector<HTMLElement>('.question-content');
  // A zero-height box means the slide isn't laid out (not the current slide);
  // measuring it would only clobber a fit we already computed.
  if (!content || content.clientHeight === 0) return 1;

  // Start from a clean slate so repeat passes (e.g. after webfonts land)
  // measure against the authored sizes rather than a previous fit.
  slide.style.removeProperty('--q-fit');
  slide.classList.remove('q-tight');
  if (!overflows(content)) return 1;

  // Tighter leading first — cheaper on legibility than smaller type, and on
  // its own it recovers a line or two.
  slide.classList.add('q-tight');
  if (!overflows(content)) return 1;

  slide.style.setProperty('--q-fit', String(MIN_SCALE));
  if (overflows(content)) return MIN_SCALE;

  let lo = MIN_SCALE; // known to fit
  let hi = 1; // known not to fit
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    slide.style.setProperty('--q-fit', mid.toFixed(3));
    if (overflows(content)) hi = mid;
    else lo = mid;
  }
  slide.style.setProperty('--q-fit', lo.toFixed(3));
  return lo;
}
