// Fetches everything needed to show a deck: the YAML, both image manifests and
// any custom-slide HTML. Used by the slides window and the scoring view.
//
// In production these are public files behind CloudFront. In local mode decks
// live in the browser (see services/eventsApi/local.ts), so the YAML and the
// event's images come from there instead.

import { isLocalMode } from "../config";
import { compileDeck } from "../deck/compile";
import type { ImageContext } from "../deck/images";
import type { CompiledDeck } from "../deck/types";
import { eventImageUrls, getYaml, listEventImages } from "../services/eventsApi";
import {
  collectCustomFileRefs,
  resolveCustomFileUrl,
  type RenderContext,
} from "./render";

export const CDN_BASE = "/cdn";

export const eventBaseFor = (uuid: string) => `/events/${uuid}`;

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  return r.text();
}

async function fetchManifest(url: string): Promise<string[]> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const data: unknown = await r.json();
    return Array.isArray(data) ? data.map(String) : [];
  } catch {
    return [];
  }
}

export async function loadDeckText(uuid: string): Promise<string> {
  if (isLocalMode) return (await getYaml(uuid)).text;
  return fetchText(`${eventBaseFor(uuid)}/event.yaml`);
}

export async function loadImageContext(uuid: string): Promise<ImageContext> {
  const eventBase = eventBaseFor(uuid);
  const [sharedImages, eventImages, localUrls] = await Promise.all([
    fetchManifest(`${CDN_BASE}/images/manifest.json`),
    isLocalMode
      ? listEventImages(uuid).catch(() => [] as string[])
      : fetchManifest(`${eventBase}/images/manifest.json`),
    isLocalMode ? eventImageUrls(uuid).catch(() => ({})) : {},
  ]);
  return {
    cdnBase: CDN_BASE,
    eventBase,
    sharedImages,
    eventImages,
    eventImageUrls: localUrls,
  };
}

export interface DeckBundle {
  text: string;
  deck: CompiledDeck;
  ctx: RenderContext;
}

export async function loadDeckBundle(uuid: string): Promise<DeckBundle> {
  const [text, images] = await Promise.all([loadDeckText(uuid), loadImageContext(uuid)]);
  const deck = compileDeck(text);

  const customSlides = new Map<string, string>();
  await Promise.all(
    collectCustomFileRefs(deck).map(async (ref) => {
      try {
        customSlides.set(ref, await fetchText(resolveCustomFileUrl(ref, images)));
      } catch {
        // The renderer shows a stand-in for files that could not be loaded.
      }
    })
  );

  return { text, deck, ctx: { ...images, customSlides } };
}
