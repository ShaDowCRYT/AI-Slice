// BullMQ worker. This is where the concurrency cap actually holds: every job
// passes through the same Worker instance, and its `concurrency` option is
// read from lib/ai/config.ts — never a magic number in this file.
//
// The unit of work is generic: a ctx describing one Job row plus a handler.
// The default handler is the real Gemini extraction (lib/ai/extract.ts); the
// queue mechanics around it stay untouched.

import type { Job, Worker } from "bullmq";
import { Worker as BullWorker } from "bullmq";
import type { Prisma } from "@prisma/client";

import { aiConfig } from "../ai/config";
import { extractionHandler } from "../ai/extract";
import { prisma } from "../prisma";
import { JOB_QUEUE_NAME } from "./queue";

export interface JobContext {
  jobId: string;
  userId: string;
  storageKey: string;
  mimeType: string;
}

export type JobHandlerResult =
  | { status: "done"; data?: unknown }
  | { status: "failed"; error: string };

export type JobHandler = (ctx: JobContext) => Promise<JobHandlerResult>;

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// The active handler is module-scoped, not per-job: one worker, one handler.
// Swapped by startWorker() — changes only what "the work" is, never the queue
// mechanics or the concurrency cap.
let currentHandler: JobHandler = extractionHandler;

async function processJob(job: Job): Promise<void> {
  const { jobId } = job.data as { jobId: string };

  const startedAt = Date.now();
  const row = await prisma.job.update({
    where: { id: jobId },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });
  console.log(`[worker] ${jobId} start ${startedAt} (${row.status})`);

  try {
    const result = await currentHandler({
      jobId,
      userId: row.userId,
      storageKey: row.storageKey,
      mimeType: row.mimeType,
    });
    const finishedAt = Date.now();

    if (result.status === "done") {
      // Json-typed field: an absent data leaves the stored value untouched
      // (Prisma distinguishes literal null from "field not written" for Json).
      const update: Prisma.JobUpdateInput = { status: "DONE" };
      if (result.data !== undefined) {
        update.extractedData = result.data as Prisma.InputJsonValue;
      }
      await prisma.job.update({ where: { id: jobId }, data: update });
      console.log(`[worker] ${jobId} done ${finishedAt} dur=${finishedAt - startedAt}ms`);
    } else {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage: result.error },
      });
      console.log(`[worker] ${jobId} failed ${finishedAt} dur=${finishedAt - startedAt}ms`);
    }
  } catch (err) {
    // A handler crash never marks the job PROCESSING forever: it becomes
    // FAILED with a real errorMessage, per security.md rule 29.
    const finishedAt = Date.now();
    const message =
      err instanceof Error ? err.message : "Worker crashed unexpectedly";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: message },
    });
    console.error(`[worker] ${jobId} crashed dur=${finishedAt - startedAt}ms: ${message}`);
  }
}

let activeWorker: Worker | null = null;

/**
 * Create (or reuse) the shared worker with the configured concurrency cap.
 * Defaults to the real Gemini extraction handler.
 */
export function startWorker(handler: JobHandler = extractionHandler): Worker {
  if (activeWorker) return activeWorker;

  currentHandler = handler;
  activeWorker = new BullWorker(JOB_QUEUE_NAME, (job) => processJob(job), {
    connection: { url: redisUrl },
    concurrency: aiConfig.queue.concurrency,
  });

  activeWorker.on("error", (err) => {
    console.error("[worker] BullMQ error:", err.message);
  });

  console.log(
    `[worker] started, concurrency=${aiConfig.queue.concurrency} (from lib/ai/config.ts)`,
  );
  return activeWorker;
}

export async function stopWorker(): Promise<void> {
  if (!activeWorker) return;
  const w = activeWorker;
  activeWorker = null;
  await w.close();
}