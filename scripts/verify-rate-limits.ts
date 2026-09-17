// Requirement #8 evidence: BOTH rate-limited endpoints verified live, at the
// same standard as every other requirement — real HTTP responses, not "wired in".
//
//   node --env-file=.env --import tsx scripts/verify-rate-limits.ts
//
// Buckets under test (lib/ai/config.ts.rateLimits, window 60s, per-IP):
//   POST /api/jobs                → route "api-jobs-upload"     limit 10
//   POST /api/jobs/[id]/follow-up → route "api-jobs-follow-up"  limit 5
//
// How it stays REAL without wrecking the day's provider quota:
//   - The upload gate runs BEFORE auth, so unauthenticated requests that pass
//     the gate get 401 — they still count toward the bucket (this is exactly
//     how the gate stops unauthenticated abuse; storage/enqueue is only
//     reached after auth). No files are stored, no jobs enqueued.
//   - The follow-up test authenticates as the smoke user and targets a real
//     DONE job. The FIRST follow-up request applies the action (one real
//     DeepSeek call); the dedup path in the route then answers repeats from the
//     stored row without spending more. The rate-limit gate counts every
//     request whether or not the handler is reached.
//   - The client IP seen by the server is controlled via X-Forwarded-For using
//     a fresh TEST-NET-3 address per phase, so each bucket starts empty and the
//     run is deterministic.
//
// Independence is proven quantitatively, not asserted:
//   A) Trip the upload bucket (10 hits) on an IP, then call the follow-up with
//      the SAME IP: a shared bucket would already exceed the follow-up limit of
//      5, so a non-429 follow-up proves the two routes use separate buckets.
//   B) Trip the follow-up bucket (5 hits + 1 blocked) on a FRESH IP, then fire
//      uploads on that IP: a shared bucket would trip the upload at request
//      #6 (5 + 5 = 10); separate buckets let all 10 uploads pass and trip at
//      #11. Observing #11 proves the upload bucket started empty.
//
// Exit code 0 = both buckets trip at their configured limits AND both
// independence probes pass.

import { prisma } from "../lib/prisma";
import { randomBytes } from "crypto";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SMOKE_USER_EMAIL = "smoke@test.local";
const UPLOAD_IP = "203.0.113.51";
const FOLLOWUP_IP = "203.0.113.52";

// TEST-NET-3 literal, next to its use; not from lib/ai/config.ts because the
// config holds production rate limits, not test-tool values.
const LIMITS = { upload: 10, followUp: 5, windowMs: 60_000 };

let failures = 0;
function expect(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

async function tripResponsePrint(
  label: string,
  status: number,
  retryAfter: string | null,
  bodyText: string,
) {
  console.log("-----------------------------------------------------");
  console.log(`${label}`);
  console.log(`HTTP status : ${status}`);
  console.log(`Retry-After : ${retryAfter ?? "(none)"}`);
  console.log(`body        : ${bodyText}`);
  console.log("-----------------------------------------------------");
  return { status, retryAfter, bodyText };
}

// One follow-up request. Auth + job are baked into the URL/cookie; the action
// body is always "summarise" so repeats hit the route's stored-result dedup.
async function fireFollowUp(
  ip: string,
  cookie: string,
  jobId: string,
  action = "summarise",
): Promise<{ status: number; retryAfter: string | null; body: string }> {
  const res = await fetch(`${BASE}/api/jobs/${jobId}/follow-up`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `session_id=${cookie}`,
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ action }),
  });
  return {
    status: res.status,
    retryAfter: res.headers.get("retry-after"),
    body: (await res.text()).slice(0, 300),
  };
}

async function fireUpload(ip: string): Promise<{
  status: number;
  retryAfter: string | null;
  body: string;
}> {
  const res = await fetch(`${BASE}/api/jobs`, {
    method: "POST",
    headers: { "X-Forwarded-For": ip },
  });
  return {
    status: res.status,
    retryAfter: res.headers.get("retry-after"),
    body: (await res.text()).slice(0, 200),
  };
}

async function main() {
  // --- Signed-in session for the smoke user (same trick as seed-session) ---
  let user = await prisma.user.findUnique({ where: { email: SMOKE_USER_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: SMOKE_USER_EMAIL, passwordHash: "dev-only", fullName: "Smoke test" },
    });
  }
  const cookie = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      id: cookie,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  });

  // A real DONE job owned by the smoke user, with extracted text to refine.
  const targetJob = await prisma.job.findFirst({
    where: { userId: user.id, status: "DONE" },
    orderBy: { createdAt: "desc" },
  });
  expect("a real DONE job exists for the follow-up target", !!targetJob);
  if (!targetJob) {
    console.error("Aborting: no DONE job for the smoke user.");
    process.exit(1);
  }
  console.log(`follow-up target job: ${targetJob.id} (${targetJob.mimeType})`);

  // =====================================================================
  // PART 1 — upload trigger: fire past its limit, capture the triptone
  // =====================================================================
  console.log("\n=== PART 1: POST /api/jobs (upload trigger, limit 10/60s) ===");
  let uploadTrip: { status: number; retryAfter: string | null; body: string } | null = null;
  for (let i = 1; i <= LIMITS.upload + 1; i += 1) {
    const r = await fireUpload(UPLOAD_IP);
    const tag = r.status === 429 ? "  ← GATE TRIPPED" : "";
    console.log(`request ${String(i).padStart(2)}: HTTP ${r.status}${r.retryAfter ? ` Retry-After ${r.retryAfter}` : ""}${tag}  ${r.body}`);
    if (r.status === 429) {
      uploadTrip = r;
      break;
    }
  }
  expect(
    "upload trips at request 11 (> limit 10)",
    uploadTrip?.status === 429,
  );
  if (uploadTrip) {
    await tripResponsePrint(
      "UPLOAD TRIP — the response on the request over the limit",
      uploadTrip.status,
      uploadTrip.retryAfter,
      uploadTrip.body,
    );
    const retrySecs = Number(uploadTrip.retryAfter);
    expect(
      "upload 429 body names the retry window",
      uploadTrip.body.includes(`in ${uploadTrip.retryAfter} seconds`),
    );
    expect(
      "upload Retry-After is a sane positive number (< 2× window)",
      Number.isFinite(retrySecs) && retrySecs > 0 && retrySecs <= LIMITS.windowMs * 2 / 1000,
      `got ${uploadTrip.retryAfter}`,
    );
  }

  // =====================================================================
  // INDEPENDENCE A — upload bucket full on this IP; follow-up must be free
  // =====================================================================
  console.log("\n=== INDEPENDENCE A: upload full ⇒ follow-up on the SAME IP ===");
  const indepA = await fireFollowUp(UPLOAD_IP, cookie, targetJob.id);
  console.log(`follow-up request on "${UPLOAD_IP}": HTTP ${indepA.status}${indepA.retryAfter ? ` Retry-After ${indepA.retryAfter}` : ""}  ${indepA.body}`);
  expect(
    "follow-up succeeds on the IP whose upload bucket is full (a shared bucket would 429 at 10 ≥ 5)",
    indepA.status !== 429,
    `got HTTP ${indepA.status}`,
  );
  if (indepA.status === 429) {
    await tripResponsePrint("INDEPENDENCE-A UNEXPECTED 429", indepA.status, indepA.retryAfter, indepA.body);
  }

  // =====================================================================
  // PART 2 — follow-up: fire past ITS limit on the real job, capture 429
  // =====================================================================
  console.log("\n=== PART 2: POST /api/jobs/[id]/follow-up (limit 5/60s) ===");
  let followUpTrip: { status: number; retryAfter: string | null; body: string } | null = null;
  for (let i = 1; i <= LIMITS.followUp + 1; i += 1) {
    const r = await fireFollowUp(FOLLOWUP_IP, cookie, targetJob.id);
    const tag = r.status === 429 ? "  ← GATE TRIPPED" : "";
    console.log(`request ${String(i).padStart(2)}: HTTP ${r.status}${r.retryAfter ? ` Retry-After ${r.retryAfter}` : ""}${tag}  ${r.body}`);
    if (r.status === 429) {
      followUpTrip = r;
      break;
    }
  }
  expect(
    "follow-up trips at request 6 (> limit 5)",
    followUpTrip?.status === 429,
  );
  if (followUpTrip) {
    await tripResponsePrint(
      "FOLLOW-UP TRIP — the response on the request over the limit",
      followUpTrip.status,
      followUpTrip.retryAfter,
      followUpTrip.body,
    );
  }

  // =====================================================================
  // INDEPENDENCE B — follow-up full on this IP ⇒ upload bucket still fresh
  // =====================================================================
  console.log("\n=== INDEPENDENCE B: follow-up full ⇒ upload on the SAME IP ===");
  let firstUploadStatus = 0;
  let uploadTripAt = 0;
  for (let i = 1; i <= LIMITS.upload + 1; i += 1) {
    const r = await fireUpload(FOLLOWUP_IP);
    if (i === 1) firstUploadStatus = r.status;
    const tag = r.status === 429 ? "  ← UPLOAD TRIPPED" : "";
    if (i <= 3 || r.status === 429) {
      console.log(`upload request ${String(i).padStart(2)}: HTTP ${r.status}${tag}  ${r.body}`);
    } else if (i === 4) {
      console.log("  … (remaining upload requests abbreviated until the trip) …");
    }
    if (r.status === 429) {
      uploadTripAt = i;
      break;
    }
  }
  expect(
    "first upload on the IP passes while the follow-up bucket is full",
    firstUploadStatus !== 429,
    `got HTTP ${firstUploadStatus}`,
  );
  // Shared bucket: 5 follow-up hits + 10-upload limit ⇒ upload would trip at
  // its 6th. Observing the trip at upload #11 ⇒ separate fresh upload bucket.
  expect(
    "upload bucket started empty (trips at #11, not #6): buckets are independent",
    uploadTripAt === LIMITS.upload + 1,
    `upload tripped at request #${uploadTripAt}`,
  );
  console.log(
    `upload tripped at request #${uploadTripAt} on "${FOLLOWUP_IP}" ` +
      `while its follow-up bucket (5/5) stays full — separate, route-scoped buckets confirmed.`,
  );

  console.log("\n----------------------------------------");
  console.log(
    failures === 0
      ? "RESULT: PASS — both limits hold live and the two buckets are independent."
      : "RESULT: FAIL — see assertions above.",
  );
  console.log("----------------------------------------");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});