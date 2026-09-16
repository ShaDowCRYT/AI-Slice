// STOP-3 evidence: dump the Job rows produced by the real upload→queue→worker→
// Gemini path. Run after the worker has processed jobs.
//   node --env-file=.env --import tsx scripts/dump-jobs.ts <jobId> [jobId ...]

import { prisma } from "../lib/prisma";

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("usage: dump-jobs.ts <jobId> [jobId ...]");
    process.exit(1);
  }
  for (const id of ids) {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) {
      console.log(`[${id}] not found`);
      continue;
    }
    console.log("----------------------------------------");
    console.log(`id           : ${job.id}`);
    console.log(`status       : ${job.status}`);
    console.log(`mimeType     : ${job.mimeType}`);
    console.log(`storageKey   : ${job.storageKey}`);
    console.log(`attempts     : ${job.attempts}`);
    console.log(`errorMessage : ${job.errorMessage ?? "(none)"}`);
    console.log(`followUpType : ${job.followUpType ?? "(none)"}`);
    console.log(`extractedData: ${JSON.stringify(job.extractedData)}`);
    console.log(`createdAt    : ${job.createdAt.toISOString()}`);
    console.log(`updatedAt    : ${job.updatedAt.toISOString()}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);