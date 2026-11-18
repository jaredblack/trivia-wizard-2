import { nanoid } from "nanoid";
import { parse as parseYaml } from "yaml";
import { ConflictError, type EventsBackend, type EventSummary } from "./types";
import { scaffoldYaml } from "./scaffold";

// localStorage-backed EventsBackend. One JSON blob under STORAGE_KEY holds
// all events; atomic read-modify-write semantics come from the fact that we
// re-parse the whole thing on every call. ETags are a monotonic counter
// (string-encoded for parity with the S3 backend's interface).

const STORAGE_KEY = "tw:eventsApi:v1";

interface EventEntry {
  yaml: string;
  etag: string;
  lastModified: string; // ISO
  images: string[];
}

interface Store {
  events: Record<string, EventEntry>;
}

// A deck with a syntax error still needs to appear in the list.
function safeParse(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
}

function readStore(): Store {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { events: {} };
  try {
    return JSON.parse(raw) as Store;
  } catch {
    return { events: {} };
  }
}

function writeStore(s: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function nextEtag(prev?: string): string {
  const n = prev ? Number(prev) : 0;
  return String((Number.isFinite(n) ? n : 0) + 1);
}

function makeEntry(yamlText: string): EventEntry {
  return {
    yaml: yamlText,
    etag: nextEtag(),
    lastModified: new Date().toISOString(),
    images: [],
  };
}

// One-time: if storage is empty, drop in a sample event so HostLanding's
// picker has something to show. Idempotent — never overwrites existing data.
function seedIfEmpty(): void {
  const s = readStore();
  if (Object.keys(s.events).length > 0) return;
  s.events["seed0001"] = {
    yaml: `title: Seed Event
subtitle: Local dev sample
slides:
- join

- category: Sample Category

- q: What's the capital of France?
  a: Paris
`,
    etag: "1",
    lastModified: new Date().toISOString(),
    images: [],
  };
  writeStore(s);
}

seedIfEmpty();

async function listEventUuids(): Promise<string[]> {
  return Object.keys(readStore().events);
}

async function getYaml(
  uuid: string
): Promise<{ text: string; etag: string }> {
  const entry = readStore().events[uuid];
  if (!entry) throw new Error(`No such event: ${uuid}`);
  return { text: entry.yaml, etag: entry.etag };
}

async function putYaml(
  uuid: string,
  text: string,
  ifMatch: string
): Promise<{ etag: string }> {
  const s = readStore();
  const entry = s.events[uuid];
  if (!entry) throw new Error(`No such event: ${uuid}`);
  if (entry.etag !== ifMatch) throw new ConflictError();
  entry.yaml = text;
  entry.etag = nextEtag(entry.etag);
  entry.lastModified = new Date().toISOString();
  writeStore(s);
  return { etag: entry.etag };
}

async function listEventImages(uuid: string): Promise<string[]> {
  const entry = readStore().events[uuid];
  if (!entry) return [];
  return [...entry.images];
}

async function putImagesManifest(
  uuid: string,
  files: string[]
): Promise<void> {
  // In S3, the manifest is a separate object derived from the bucket listing.
  // Locally there's no separate "bucket listing", so writing the manifest is
  // the same as updating the event's image list.
  const s = readStore();
  const entry = s.events[uuid];
  if (!entry) throw new Error(`No such event: ${uuid}`);
  entry.images = [...files];
  entry.lastModified = new Date().toISOString();
  writeStore(s);
}

// Image bytes go in IndexedDB: localStorage is too small for more than a
// couple of photos.
const IMAGE_DB = "tw-events-images";
const IMAGE_STORE = "images";

function imageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IMAGE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IMAGE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const imageKey = (uuid: string, filename: string) => `${uuid}/${filename}`;
const objectUrls = new Map<string, string>();

async function uploadEventImage(
  uuid: string,
  filename: string,
  data: Blob
): Promise<void> {
  const db = await imageDb();
  await idb(
    db.transaction(IMAGE_STORE, "readwrite").objectStore(IMAGE_STORE).put(data, imageKey(uuid, filename))
  );
  const stale = objectUrls.get(imageKey(uuid, filename));
  if (stale) {
    URL.revokeObjectURL(stale);
    objectUrls.delete(imageKey(uuid, filename));
  }
  const files = await listEventImages(uuid);
  if (!files.includes(filename)) await putImagesManifest(uuid, [...files, filename]);
}

async function eventImageUrls(uuid: string): Promise<Record<string, string>> {
  const files = await listEventImages(uuid);
  if (files.length === 0) return {};
  const db = await imageDb();
  const out: Record<string, string> = {};
  for (const filename of files) {
    const key = imageKey(uuid, filename);
    let url = objectUrls.get(key);
    if (!url) {
      const blob = await idb<Blob | undefined>(
        db.transaction(IMAGE_STORE).objectStore(IMAGE_STORE).get(key)
      );
      if (!blob) continue;
      url = URL.createObjectURL(blob);
      objectUrls.set(key, url);
    }
    out[filename] = url;
  }
  return out;
}

async function listEvents(): Promise<EventSummary[]> {
  const s = readStore();
  const rows: EventSummary[] = Object.entries(s.events).map(([uuid, entry]) => {
    const parsed = safeParse(entry.yaml) as
      | { title?: string; subtitle?: string }
      | null;
    return {
      uuid,
      title: parsed?.title ?? "(untitled)",
      subtitle: parsed?.subtitle ?? null,
      lastModified: new Date(entry.lastModified),
    };
  });
  rows.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  return rows;
}

async function mintEvent(): Promise<string> {
  const s = readStore();
  const uuid = nanoid(8);
  s.events[uuid] = makeEntry(scaffoldYaml());
  writeStore(s);
  return uuid;
}

export const localBackend: EventsBackend = {
  listEventUuids,
  listEvents,
  getYaml,
  putYaml,
  listEventImages,
  putImagesManifest,
  uploadEventImage,
  eventImageUrls,
  mintEvent,
};
