import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import yaml from "js-yaml";
import { ASSETS_BUCKET, AWS_REGION, getCredentials } from "../../aws";
import { ConflictError, type EventsBackend, type EventSummary } from "./types";
import { scaffoldYaml } from "./scaffold";

let _client: S3Client | null = null;
async function client(): Promise<S3Client> {
  if (_client) return _client;
  _client = new S3Client({
    region: AWS_REGION,
    credentials: await getCredentials(),
  });
  return _client;
}

const eventKey = (uuid: string) => `events/${uuid}/event.yaml`;

async function listEventUuids(): Promise<string[]> {
  const c = await client();
  const uuids: string[] = [];
  let token: string | undefined;
  do {
    const res = await c.send(
      new ListObjectsV2Command({
        Bucket: ASSETS_BUCKET,
        Prefix: "events/",
        Delimiter: "/",
        ContinuationToken: token,
      })
    );
    for (const cp of res.CommonPrefixes ?? []) {
      const m = cp.Prefix?.match(/^events\/([^/]+)\/$/);
      if (m) uuids.push(m[1]);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return uuids;
}

async function getYaml(
  uuid: string
): Promise<{ text: string; etag: string }> {
  const c = await client();
  const res = await c.send(
    new GetObjectCommand({ Bucket: ASSETS_BUCKET, Key: eventKey(uuid) })
  );
  const text = await res.Body!.transformToString();
  if (!res.ETag) throw new Error(`Missing ETag on ${eventKey(uuid)}`);
  return { text, etag: res.ETag };
}

async function putYaml(
  uuid: string,
  text: string,
  ifMatch: string
): Promise<{ etag: string }> {
  const c = await client();
  try {
    const res = await c.send(
      new PutObjectCommand({
        Bucket: ASSETS_BUCKET,
        Key: eventKey(uuid),
        Body: text,
        ContentType: "application/x-yaml",
        IfMatch: ifMatch,
      })
    );
    if (!res.ETag) throw new Error(`Missing ETag on PUT response`);
    return { etag: res.ETag };
  } catch (err) {
    if (err instanceof Error && err.name === "PreconditionFailed") {
      throw new ConflictError();
    }
    throw err;
  }
}

async function listEventImages(uuid: string): Promise<string[]> {
  const c = await client();
  const files: string[] = [];
  const prefix = `events/${uuid}/images/`;
  let token: string | undefined;
  do {
    const res = await c.send(
      new ListObjectsV2Command({
        Bucket: ASSETS_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      const name = obj.Key.slice(prefix.length);
      if (!name || name === "manifest.json") continue;
      files.push(name);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return files;
}

async function putImagesManifest(
  uuid: string,
  files: string[]
): Promise<void> {
  const c = await client();
  await c.send(
    new PutObjectCommand({
      Bucket: ASSETS_BUCKET,
      Key: `events/${uuid}/images/manifest.json`,
      Body: JSON.stringify(files),
      ContentType: "application/json",
    })
  );
}

async function listEvents(): Promise<EventSummary[]> {
  const c = await client();
  const uuids = await listEventUuids();
  const rows = await Promise.all(
    uuids.map(async (uuid) => {
      const key = eventKey(uuid);
      const [head, get] = await Promise.all([
        c.send(new HeadObjectCommand({ Bucket: ASSETS_BUCKET, Key: key })),
        c.send(new GetObjectCommand({ Bucket: ASSETS_BUCKET, Key: key })),
      ]);
      const text = await get.Body!.transformToString();
      const parsed = yaml.load(text) as
        | { title?: string; subtitle?: string }
        | null;
      return {
        uuid,
        title: parsed?.title ?? "(untitled)",
        subtitle: parsed?.subtitle ?? null,
        lastModified: head.LastModified ?? new Date(0),
      };
    })
  );
  rows.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  return rows;
}

async function mintEvent(): Promise<string> {
  const c = await client();
  const uuid = nanoid(8);
  await c.send(
    new PutObjectCommand({
      Bucket: ASSETS_BUCKET,
      Key: eventKey(uuid),
      Body: scaffoldYaml(),
      ContentType: "application/x-yaml",
    })
  );
  return uuid;
}

export const s3Backend: EventsBackend = {
  listEventUuids,
  listEvents,
  getYaml,
  putYaml,
  listEventImages,
  putImagesManifest,
  mintEvent,
};
