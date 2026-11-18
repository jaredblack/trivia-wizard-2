// Resolving an image reference to a URL. Shared by the slide renderer and the
// editor so a name means the same thing in both.
//
//   https://…   used as written
//   /path       used as written
//   name        this event's images first, then the shared ones
//   ./name      accepted for decks converted from the old format; same as `name`
//
// Names match by stem (filename without extension), ignoring case.

export interface ImageContext {
  /** URL prefix for shared files, e.g. `/cdn`. */
  cdnBase: string;
  /** URL prefix for this event's files, e.g. `/events/<uuid>`. */
  eventBase: string;
  /** Filenames in the shared images folder. */
  sharedImages: string[];
  /** Filenames in this event's images folder. */
  eventImages: string[];
  /**
   * URLs for event images that are not served from `eventBase`, keyed by
   * filename. Used in local development, where uploads live in the browser.
   */
  eventImageUrls?: Record<string, string>;
}

export type ResolvedImage =
  | { found: true; url: string; external: boolean; scope: "event" | "shared" | "url" }
  | { found: false };

const stem = (file: string) => file.replace(/\.[^.]+$/, "").toLowerCase();

export function isExternalRef(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

export function resolveImage(ref: string, ctx: ImageContext): ResolvedImage {
  if (!ref) return { found: false };
  if (isExternalRef(ref)) return { found: true, url: ref, external: true, scope: "url" };
  if (ref.startsWith("/")) return { found: true, url: ref, external: false, scope: "url" };

  const needle = (ref.startsWith("./") ? ref.slice(2) : ref).toLowerCase();

  const inEvent = ctx.eventImages.find((f) => stem(f) === needle);
  if (inEvent) {
    const url = ctx.eventImageUrls?.[inEvent] ?? `${ctx.eventBase}/images/${inEvent}`;
    return { found: true, url, external: false, scope: "event" };
  }
  const inShared = ctx.sharedImages.find((f) => stem(f) === needle);
  if (inShared) {
    return {
      found: true,
      url: `${ctx.cdnBase}/images/${inShared}`,
      external: false,
      scope: "shared",
    };
  }
  return { found: false };
}

/** Every stem a deck can refer to, event images first. */
export function knownImageNames(ctx: ImageContext): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...ctx.eventImages, ...ctx.sharedImages]) {
    const s = stem(f);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Image names in a deck that resolve to nothing, with where each one is. */
export function missingImages<T extends { ref: string }>(images: T[], ctx: ImageContext): T[] {
  return images.filter((img) => !resolveImage(img.ref, ctx).found);
}
