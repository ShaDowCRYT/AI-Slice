// BullMQ queue that decouples "job accepted" from "job processed". The upload
// route enqueues and returns immediately; the worker picks jobs up later.
// Connection passes a URL, not an ioredis instance, so BullMQ manages its own
// (bundled) connection — the project's explicit ioredis dependency stays
// unused unless a direct connection is needed.
//
// Relative imports (not "@/") so this module also runs standalone under tsx,
// which is how the worker is launched in dev.

import { Queue } from "bullmq";

export const JOB_QUEUE_NAME = "note-extraction";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const jobQueue = new Queue(JOB_QUEUE_NAME, {
  connection: { url: redisUrl },
});

// A "unit of work" is one uploaded photo → one Job row → one queue entry.
// The queue entry carries only the row id; status lives in the Job row.
export function buildExtractionJobData(input: {
  jobId: string;
  userId: string;
  storageKey: string;
  mimeType: string;
}) {
  return {
    jobId: input.jobId,
    userId: input.userId,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
  };
}