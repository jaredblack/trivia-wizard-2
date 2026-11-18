export class ConflictError extends Error {
  constructor(message = "ETag conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

export interface EventSummary {
  uuid: string;
  title: string;
  subtitle: string | null;
  lastModified: Date;
}

export interface EventsBackend {
  listEventUuids(): Promise<string[]>;
  listEvents(): Promise<EventSummary[]>;
  getYaml(uuid: string): Promise<{ text: string; etag: string }>;
  putYaml(
    uuid: string,
    text: string,
    ifMatch: string
  ): Promise<{ etag: string }>;
  listEventImages(uuid: string): Promise<string[]>;
  putImagesManifest(uuid: string, files: string[]): Promise<void>;
  /** Store one image in the event's folder and republish its manifest. */
  uploadEventImage(uuid: string, filename: string, data: Blob): Promise<void>;
  /**
   * URLs for event images that are not served from /events/<uuid>/images/,
   * keyed by filename. Empty in production; in local mode uploads live in the
   * browser and are only reachable this way.
   */
  eventImageUrls(uuid: string): Promise<Record<string, string>>;
  mintEvent(): Promise<string>;
}
