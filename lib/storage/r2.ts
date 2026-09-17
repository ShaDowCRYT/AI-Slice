// Object storage for uploaded note photos.
//
// Primary backend: Cloudflare R2 via the AWS S3 SDK (R2 is S3-compatible).
// The database stores only the storage key returned here — never file bytes.
//
// Dev-only substitute (per PRD requirement #9 and security.md rule 34): when
// R2 credentials in .env are still the placeholders from .env.example, this
// falls back to local disk under .data/uploads/ with the same interface and
// the same storage-key format, so the whole slice is buildable and testable
// without real R2 creds. This mode is clearly dev-only — the human swapping
// in real R2_* values switches the backend with no code change.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { lookup } from "node:dns";
import https from "node:https";
import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");

function isPlaceholder(value: string | undefined): boolean {
  return !value || value.includes("your-");
}

function isR2Configured(): boolean {
  return (
    !isPlaceholder(process.env.R2_ACCESS_KEY_ID) &&
    !isPlaceholder(process.env.R2_SECRET_ACCESS_KEY) &&
    !isPlaceholder(process.env.R2_BUCKET_NAME) &&
    !isPlaceholder(process.env.R2_ENDPOINT)
  );
}

export function storageBackend(): "r2" | "local-dev" {
  return isR2Configured() ? "r2" : "local-dev";
}

let s3: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3) {
    // forcePathStyle: R2's S3-compatible endpoint is path-style only.
    // Without it the AWS SDK defaults to virtual-hosted addressing and won't
    // resolve the bucket-prefixed hostname (R2 returns ENOTFOUND), verified
    // live with a real R2 account.
    // Explicit lookup: Node's internal net-level getaddrinfo call for this
    // hostname returned ENOTFOUND on this machine (isolated against a plain
    // https.request to the same host resolving fine within the same process).
    // Pinning an agent whose lookup goes through node:dns.lookup fixed it.
    // NodeHttpHandler is pinned explicitly as the transport.
    s3 = new S3Client({
      region: "auto",
      forcePathStyle: true,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 10000,
        httpsAgent: new https.Agent({ lookup }),
      }),
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return s3;
}

export interface UploadInput {
  data: Buffer;
  mimeType: string;
  ext: string;
}

/**
 * Upload a file and return the storage key. The key format is identical for
 * both backends (uploads/{userId}/{uuid}.{ext}), so Job.storageKey never
 * depends on which backend is active.
 */
export async function uploadFile(
  input: UploadInput,
  userId: string,
): Promise<string> {
  const key = `uploads/${userId}/${randomUUID()}.${input.ext}`;

  if (storageBackend() === "r2") {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: input.data,
        ContentType: input.mimeType,
      }),
    );
  } else {
    await mkdir(path.dirname(path.join(LOCAL_UPLOAD_DIR, key)), {
      recursive: true,
    });
    await writeFile(path.join(LOCAL_UPLOAD_DIR, key), input.data);
  }

  return key;
}

/** Read a stored object's bytes back, used by the worker to feed the image to Gemini. */
export async function readFileBytes(key: string): Promise<Buffer> {
  if (storageBackend() === "r2") {
    const res = await getS3Client().send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      }),
    );
    const body = res.Body as { transformToByteArray: () => Promise<Uint8Array> };
    return Buffer.from(await body.transformToByteArray());
  }
  return readFile(path.join(LOCAL_UPLOAD_DIR, key));
}

/** Delete a stored object — used on the rollback path when enqueueing fails. */
export async function deleteFile(key: string): Promise<void> {
  if (storageBackend() === "r2") {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      }),
    );
    return;
  }
  await rm(path.join(LOCAL_UPLOAD_DIR, key), { force: true });
}