import { isLocalMode } from "../../config";
import type { EventsBackend } from "./types";
import { s3Backend } from "./s3";
import { localBackend } from "./local";

export { ConflictError, type EventSummary } from "./types";

const backend: EventsBackend = isLocalMode ? localBackend : s3Backend;

export const listEventUuids = backend.listEventUuids.bind(backend);
export const listEvents = backend.listEvents.bind(backend);
export const getYaml = backend.getYaml.bind(backend);
export const putYaml = backend.putYaml.bind(backend);
export const listEventImages = backend.listEventImages.bind(backend);
export const putImagesManifest = backend.putImagesManifest.bind(backend);
export const mintEvent = backend.mintEvent.bind(backend);
