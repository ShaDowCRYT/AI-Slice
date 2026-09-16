// Dev tool: runs the BullMQ worker standalone (Next dev does not start it).
//   node --env-file=.env --import tsx scripts/run-worker.ts

import { startWorker, stopWorker } from "../lib/queue/worker";

startWorker();
console.log("[run-worker] worker running; press Ctrl+C to stop");

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[run-worker] shutting down…");
  await stopWorker();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);