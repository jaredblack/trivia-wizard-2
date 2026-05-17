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
  mintEvent(): Promise<string>;
}
