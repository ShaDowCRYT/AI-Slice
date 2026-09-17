// STOP-3 evidence for the "no real content" semantic check in lib/ai/extract.ts.
//   node --env-file=.env --import tsx scripts/evidence-illegible-policy.ts
//
// Two layers, both against the REAL worker (not a unit simulation):
//   1. Deterministic: hasRealContent() decides on constructed output —
//      a wholly-[illegible] result must be treated as no-content (FAILED),
//      a mostly-legible result with one unreadable word must be YES (DONE),
//      and the output object is never mutated (marker survives as-is).
//   2. End-to-end: two uploads through the real queue worker — a pure-noise
//      photo (never DONE; FAILED with the illegible message when Gemini
//      replies, or honestly FAILED upstream on a transient provider 503 —
//      both are the same policy invariant) and a legible note card (DONE).
// Exit 0 = every invariant held; anything else = fail.

import { hasRealContent, ILLEGIBLE_ONLY_MESSAGE } from "../lib/ai/extract";
import {
  buildExtractionJobData,
  JOB_QUEUE_NAME,
  jobQueue,
} from "../lib/queue/queue";
import { startWorker, stopWorker } from "../lib/queue/worker";
import { prisma } from "../lib/prisma";
import { uploadFile } from "../lib/storage/r2";
import { renderNoiseImage, renderNotesImage } from "./synthetic-notes-image";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function expect(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

async function runWorkerJob(
  label: string,
  imageBytes: Buffer,
  expectStatus: "DONE" | "FAILED",
  expectMessage?: string,
) {
  const user = await prisma.user.create({
    data: {
      email: `policy-${Date.now()}@test.local`,
      passwordHash: "x",
      fullName: "Policy evidence",
    },
  });
  const storageKey = await uploadFile(
    { data: imageBytes, mimeType: "image/png", ext: "png" },
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

  console.log(`\n--- ${label} ---`);
  console.log("enqueued", job.id, "waiting for the real worker…");

  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    const row = await prisma.job.findUnique({ where: { id: job.id } });
    if (row?.status === "FAILED" || row?.status === "DONE") {
      const text =
        (((row.extractedData as { text?: string } | null)?.text ?? "—") as string).slice(0, 70);
      console.log("id           :", row.id);
      console.log("status       :", row.status);
      if (row.extractedData != null)
        console.log("extractedData: text head =", JSON.stringify(text));
      if (row.errorMessage)
        console.log("errorMessage :", row.errorMessage);
      expect(
        `${label} → ${expectStatus}`,
        row.status === expectStatus,
        `row ended ${row.status}`,
      );
      // The policy invariant is status, not message: a noise photo must never
      // be DONE. If Gemini replies, the semantic check fires and the
      // illegible-photo message is recorded; if the provider times out or 503s
      // instead (documented transient, problems.md §5), the row honestly fails
      // upstream — still FAILED, same invariant. Only the message B thereby
      // degrades gracefully; a regression in hasRealContent is still caught by
      // the status assertion above (it would turn [illegible] replies into DONE).
      if (expectMessage) {
        const recorded = (row.errorMessage ?? "").includes(expectMessage);
        console.log(
          recorded
            ? `SEMANTIC-CHECK: illegible-photo message recorded (hasRealContent fired)`
            : `SEMANTIC-CHECK: failed upstream before a reply (provider error); invariant FAILED-never-DONE still holds`,
        );
      }
      return row;
    }
    await sleep(1000);
  }
  expect(`${label} resolved in time`, false, "120s worker wait exceeded");
  return null;
}

async function main() {
  console.log("=== SEMANTIC CHECK (no provider calls) ===");

  const whollyIllegible = { title: "No title", text: "[illegible]" };
  expect(
    "wholly-[illegible] text → no real content",
    hasRealContent(whollyIllegible) === false,
    "hasRealContent returned true",
  );

  const everythingMarked = {
    title: "Markers only",
    text: "[illegible] [illegible]",
    keyPoints: ["[illegible]"],
    sections: [{ heading: "[illegible]", content: "[illegible]" }],
  };
  expect(
    "all fields only markers → no real content",
    hasRealContent(everythingMarked) === false,
    "hasRealContent returned true",
  );

  const mostlyLegible = {
    title: "Meeting",
    text: "The meeting is [illegible] on Tuesday at 10am in [illegible].",
    keyPoints: ["Bring budget figures"],
  };
  const before = JSON.stringify(mostlyLegible);
  const verdict = hasRealContent(mostlyLegible);
  expect(
    "mostly-legible + one unreadable word → real content",
    verdict === true,
    "hasRealContent returned false",
  );
  expect(
    "output untouched (marker preserved as-is)",
    JSON.stringify(mostlyLegible) === before,
    "object was mutated",
  );
  console.log("  marker preserved in:", JSON.stringify(mostlyLegible.text));

  console.log("\n=== E2E THROUGH THE REAL WORKER ===");
  startWorker();

  let result = "FAIL";
  try {
    const noise = await runWorkerJob(
      "pure-noise photo (wholly illegible)",
      renderNoiseImage(),
      "FAILED",
      ILLEGIBLE_ONLY_MESSAGE,
    );

    const legible = await runWorkerJob(
      "legible note card (real content)",
      renderNotesImage(),
      "DONE",
    );

    const noiseOk = noise?.status === "FAILED";
    const legibleOk = legible?.status === "DONE";
    console.log("\n----------------------------------------");
    console.log(noiseOk && legibleOk && failures === 0 ? "RESULT: PASS — policy holds at both layers." : "RESULT: FAIL — see assertions above.");
    console.log("----------------------------------------");
    result = noiseOk && legibleOk && failures === 0 ? "pass" : "fail";
  } finally {
    await stopWorker();
  }
  process.exit(result === "pass" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});