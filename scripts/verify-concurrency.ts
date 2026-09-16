// Phase-2 evidence: proves the queue worker's concurrency cap holds BEFORE any
// real Gemini integration exists. It enqueues N dummy jobs and measures the
// maximum number "in flight" simultaneously, using the SAME Worker module and
// the SAME concurrency value (lib/ai/config.ts) production will use — only the
// handler body is fake (a fixed sleep), which is exactly what the build order
// asks for at this stage.
//
//   node --env-file=.env --import tsx scripts/verify-concurrency.ts
//
// Exit code 0 = cap held; 1 = cap violated.

import {
  buildExtractionJobData,
  JOB_QUEUE_NAME,
  jobQueue,
} from "../lib/queue/queue";
import type { JobContext, JobHandler } from "../lib/queue/worker";
import { startWorker, stopWorker } from "../lib/queue/worker";
import { aiConfig } from "../lib/ai/config";
import { prisma } from "../lib/prisma";

const JOBS_TO_ENQUEUE = 6;

// Standalone evidence tool, not app code: the dummy handler's own sleep is a
// local constant here, deliberately NOT in lib/ai/config.ts (which holds only
// production values — the phase-2 fakeSleepMs was removed when the real Gemini
// handler landed).
const DUMMY_SLEEP_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const testEmail = `concurrency-${Date.now()}@test.local`;
  const user = await prisma.user.create({
    data: { email: testEmail, passwordHash: "x", fullName: "Concurrency test" },
  });

  const jobIds: string[] = [];
  for (let i = 0; i < JOBS_TO_ENQUEUE; i += 1) {
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        status: "PENDING",
        storageKey: `uploads/concurrency-test/${i}.jpg`,
        mimeType: "image/jpeg",
      },
    });
    jobIds.push(job.id);
    await jobQueue.add(
      JOB_QUEUE_NAME,
      buildExtractionJobData({
        jobId: job.id,
        userId: user.id,
        storageKey: job.storageKey ?? "",
        mimeType: job.mimeType,
      }),
      { removeOnComplete: false, removeOnFail: false },
    );
  }
  console.log(`[verify] enqueued ${jobIds.length} jobs at ${Date.now()}`);

  // Tracking handler: increments a counter on entry, decrements on exit, and
  // records the running maximum — the direct measure of concurrency.
  let active = 0;
  let maxActive = 0;
  const timeline: string[] = [];

  const trackingHandler: JobHandler = async (ctx: JobContext) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    timeline.push(`++ ${ctx.jobId.slice(-6)} active=${active} max=${maxActive} @${Date.now()}`);
    console.log(timeline[timeline.length - 1]);

    await sleep(DUMMY_SLEEP_MS);

    active -= 1;
    timeline.push(`-- ${ctx.jobId.slice(-6)} active=${active} @${Date.now()}`);
    console.log(timeline[timeline.length - 1]);
    return { status: "done", data: { fake: true } };
  };

  startWorker(trackingHandler);

  // Wait until every job has finished (worker log lines per job), or 45s cap.
  const startedAt = Date.now();
  while (timeline.filter((l) => l.startsWith("--")).length < JOBS_TO_ENQUEUE) {
    if (Date.now() - startedAt > 45_000) {
      console.error("[verify] timed out waiting for jobs to finish");
      process.exit(1);
    }
    await sleep(500);
  }

  await stopWorker();

  const wallMs = Date.now() - startedAt;
  const cap = aiConfig.queue.concurrency;
  console.log("-----------------------------------------------------");
  console.log(`configured concurrency cap : ${cap}`);
  console.log(`maximum simultaneously active : ${maxActive}`);
  console.log(`wall clock for ${JOBS_TO_ENQUEUE} jobs : ${wallMs}ms`);
  console.log(`expected minimum with cap ${cap}: approx ${Math.ceil(JOBS_TO_ENQUEUE / cap) * DUMMY_SLEEP_MS}ms`);
  console.log("-----------------------------------------------------");

  if (maxActive > cap) {
    console.error("CONCURRENCY CAP VIOLATED — more jobs ran in parallel than configured.");
    process.exit(1);
  }
  console.log("PASS — the concurrency cap holds.");
  recordJobIds(user.id, jobIds);
  process.exit(0);
}

// Survival hook so the script can also print the created job ids when run manually.
function recordJobIds(_userId: string, jobIds: string[]): void {
  console.log(`[verify] job ids (for inspection via the jobs table): ${jobIds.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});