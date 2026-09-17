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
//
// Isolation (hardened 2026-09-17, problems.md §9c): the test runs on its own
// per-run queue name (note-extraction-concurrency-<timestamp>), NOT the
// production queue. A live `npm run worker` process holds the production queue
// and would otherwise grab some of these dummy jobs and fail them on R2
// ("The specified key does not exist"), which is exactly what contaminated the
// 09:40 and 10:17 runs. The script reports the live production-worker count via
// Queue#getWorkers() (Redis CLIENT LIST) so the proof run can show the
// isolation held while a production worker was attached — but a live worker
// can never pick up a test job, which is the actual guarantee.
//
// Alternative considered and rejected (same record, problems.md §9c): refusing
// to run when a live consumer is detected. That is a TOCTOU race — it cannot
// guarantee isolation *during* the run — and its evidence is just a refusal
// message. The dedicated queue makes contamination structurally impossible.

import { Queue } from "bullmq";
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
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// Per-run queue name keeps runs isolated from each other and from the
// production queue a live worker is draining.
const TEST_QUEUE_NAME = `note-extraction-concurrency-${Date.now()}`;

// Standalone evidence tool, not app code: the dummy handler's own sleep is a
// local constant here, deliberately NOT in lib/ai/config.ts (which holds only
// production values — the phase-2 fakeSleepMs was removed when the real Gemini
// handler landed).
const DUMMY_SLEEP_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const testQueue = new Queue(TEST_QUEUE_NAME, {
    connection: { url: redisUrl },
  });

  // Report how many live workers are draining the PRODUCTION queue right now
  // — the proof that isolation is being exercised, and that the run below
  // succeeds regardless. Queue connections are not CLIENT SETNAME'd, so this
  // counts only actual Worker blocking connections.
  const liveWorkers = await jobQueue.getWorkers();

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
    await testQueue.add(
      TEST_QUEUE_NAME,
      buildExtractionJobData({
        jobId: job.id,
        userId: user.id,
        storageKey: job.storageKey ?? "",
        mimeType: job.mimeType,
      }),
      { removeOnComplete: false, removeOnFail: false },
    );
  }
  console.log(
    `[verify] enqueued ${jobIds.length} jobs on isolated queue "${TEST_QUEUE_NAME}" at ${Date.now()}`,
  );
  console.log(
    `[verify] live worker(s) on production queue "${JOB_QUEUE_NAME}": ${liveWorkers.length}` +
      (liveWorkers.length > 0
        ? ` (${liveWorkers.map((w) => w.addr ?? "?").join(", ")}) — isolation under test`
        : ""),
  );

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

  // The test worker runs on the ISOLATED queue; the cap still comes from
  // lib/ai/config.ts via the same Worker module production uses.
  startWorker(trackingHandler, TEST_QUEUE_NAME);

  // Wait until every job has finished (worker log lines per job), or 45s cap.
  const startedAt = Date.now();
  let timedOut = false;
  while (timeline.filter((l) => l.startsWith("--")).length < JOBS_TO_ENQUEUE) {
    if (Date.now() - startedAt > 45_000) {
      console.error("[verify] timed out waiting for jobs to finish");
      timedOut = true;
      break;
    }
    await sleep(500);
  }

  await stopWorker();
  try {
    await testQueue.close();
  } catch (err) {
    console.error("[verify] (non-fatal) closing test queue:", err);
  }

  if (timedOut) {
    process.exit(1);
  }

  const wallMs = Date.now() - startedAt;
  const cap = aiConfig.queue.concurrency;
  console.log("-----------------------------------------------------");
  console.log(`configured concurrency cap : ${cap}`);
  console.log(`maximum simultaneously active : ${maxActive}`);
  console.log(`wall clock for ${JOBS_TO_ENQUEUE} jobs : ${wallMs}ms`);
  console.log(`expected minimum with cap ${cap}: approx ${Math.ceil(JOBS_TO_ENQUEUE / cap) * DUMMY_SLEEP_MS}ms`);
  console.log(`production workers live during run : ${liveWorkers.length}`);
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