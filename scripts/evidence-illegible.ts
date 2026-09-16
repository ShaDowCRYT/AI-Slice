// STOP-3 evidence: an unreadable photo must produce a FAILED Job row through
// the REAL worker (not a unit simulation). Mirrors exactly what an upload does:
// store → Job row (PENDING) → enqueue → worker → handler decision → row update.
//   node --env-file=.env --import tsx scripts/evidence-illegible.ts
// Exit 0 = row FAILED with the illegible message; anything else = fail.

import {
  buildExtractionJobData,
  JOB_QUEUE_NAME,
  jobQueue,
} from "../lib/queue/queue";
import { startWorker, stopWorker } from "../lib/queue/worker";
import { prisma } from "../lib/prisma";
import { uploadFile } from "../lib/storage/r2";
import { renderNoiseImage } from "./synthetic-notes-image";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const user = await prisma.user.create({
    data: {
      email: `illegible-${Date.now()}@test.local`,
      passwordHash: "x",
      fullName: "Illegible evidence",
    },
  });

  const storageKey = await uploadFile(
    { data: renderNoiseImage(), mimeType: "image/png", ext: "png" },
    user.id,
  );
  const job = await prisma.job.create({
    data: {
      userId: user.id,
      status: "PENDING",
      storageKey,
      mimeType: "image/png",
    },
  });
  await jobQueue.add(
    JOB_QUEUE_NAME,
    buildExtractionJobData({
      jobId: job.id,
      userId: user.id,
      storageKey,
      mimeType: "image/png",
    }),
    { removeOnComplete: true, removeOnFail: true },
  );

  startWorker();
  console.log(`[evidence] enqueued ${job.id}; waiting for the real worker…`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    const row = await prisma.job.findUnique({ where: { id: job.id } });
    if (row?.status === "FAILED") {
      console.log("----------------------------------------");
      console.log(`id           : ${row.id}`);
      console.log(`status       : ${row.status}`);
      console.log(`attempts     : ${row.attempts}`);
      console.log(`extractedData: ${JSON.stringify(row.extractedData)}`);
      console.log(`errorMessage : ${row.errorMessage}`);
      console.log("----------------------------------------");
      const ok = (row.errorMessage ?? "")
        .includes("couldn't be read clearly");
      await stopWorker();
      console.log(ok ? "RESULT: PASS — FAILED row records the illegible-photo message." : "RESULT: FAIL — unexpected message.");
      process.exit(ok ? 0 : 1);
    }
    if (row?.status === "DONE") {
      await stopWorker();
      console.error("RESULT: FAIL — noise photo was marked DONE, not FAILED.");
      process.exit(1);
    }
    await sleep(1000);
  }

  await stopWorker();
  console.error("RESULT: FAIL — timed out waiting for the worker.");
  process.exit(1);
}

main().catch(async (err) => {
  await stopWorker();
  console.error(err);
  process.exit(1);
});