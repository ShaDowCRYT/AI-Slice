# DOCUMENTATION.md — The AI Integration Slice (Assessment 3)

## 1. Overview and scope

A single, narrow slice: a signed-in user uploads a photo of handwritten notes,
a **background job** extracts structured text via **Gemini**, the result is
shown on a result screen, and the user can trigger **one** follow-up action
(summarise / rephrase / expand) that is reworked by **DeepSeek**. Nothing more:
no landing page, no editing/sharing/exporting, no extra accounts. Full scope is
`docs/PRD.md`; engineering rules live in `.agents/rules/`.

## 2. Stack and external services

The locked stack from the PRD, used as specified:

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Database | PostgreSQL 16 (Docker) via Prisma 6 |
| Queue | BullMQ 6 + Redis 7 (Docker) |
| Object storage | Cloudflare R2 (AWS SDK, S3-compatible) |
| Validation | Zod, with `zod-to-json-schema` for requesting Gemini's structured output |
| Extraction model | `gemini-3.6-flash` via `@google/genai` |
| Follow-up model | `deepseek-chat` via the **official OpenAI SDK** pointed at `https://api.deepseek.com` |

DeepSeek has no SDK of its own; using the OpenAI SDK against its
OpenAI-compatible endpoint is a deliberate, documented use of the brief's
"compatible official SDK" allowance (expanded in §5.2). Every changeable value
— model IDs, timeouts, token caps, temperature, rate limits, concurrency — lives
in `lib/ai/config.ts` and is imported, never restated.

## 3. Auth: reuse of Assessment 1 (explicit statement)

**Authentication is reused wholesale from Assessment 1 (the auth slice).** The
`User`, `Session`, `VerificationCode`, and `PasswordResetToken` models,
the seven auth routes (`/api/auth/*`: signup, signin, verify, resend-code,
forgot-password, verify-reset-code, reset-password), the six auth pages, the
session-cookie middleware, and the SMTP email helper were carried over and
integrated with the locked `Job` model (a `user` relation was added to `User`).
This is permitted by `docs/PRD.md` ("You may reuse the authentication slice from
Assessment 1"). The Job model itself is unchanged from the locked schema.

## 4. Architecture at a glance

The flow is explicitly not a blocking request:

```
POST /api/jobs
  → validate upload (Zod: type, size, mime)
  → rate-limited (10/min/IP)
  → store bytes in R2, keep only the storage key
  → create Job row: PENDING (storageKey, mimeType)
  → enqueue on BullMQ "note-extraction" — respond 201 immediately, never wait for the model

Worker (scripts/run-worker.ts, BullMQ concurrency = config)
  → PENDING → PROCESSING
  → read bytes from R2 → Gemini structured-output call → Zod re-validation
  → semantic check: real content survived?  (see §5.5)
  → DONE (extractedData = validated JSON) or FAILED (errorMessage)
  → handler crash can never leave a stuck PROCESSING row

GET /api/jobs/[id]  →  honest status/error slice for the processing & result screens

POST /api/jobs/[id]/follow-up  →  rate-limited (5/min/IP), deduped,
  → DeepSeek hides the action, result stored on the row, never a second queued job
```

## 5. Concepts

This section is the PRD's "Concepts to Document (Section 5)".

### 5.1 What an API endpoint is

An API endpoint is a named URL + HTTP method that performs one side-effectful or
read-only operation. This app exposes a small set: `POST /api/jobs` creates a
unit of work, `GET /api/jobs/[id]` reads one unit's state, `POST
/api/jobs/[id]/follow-up` refines a completed result, and the auth endpoints
manage sessions. Each is a thin adapter: it validates input, applies an
ownership scope, and calls a `lib/` function — it does **not** contain
business/provider logic, and it never restates a model name, timeout, token cap,
or limit. The endpoint's job is translation between HTTP and application code,
which is why uploads return `201` immediately and the real work happens behind
the queue.

### 5.2 SDKs vs. raw HTTP, and why official SDKs (DeepSeek decision)

Raw HTTP against provider REST APIs is possible but means hand-rolling auth
headers, retry/timeout plumbing, schema plumbing, and (worse) pinning against a
JSON shape you copied from docs that can drift. An official SDK encodes those
contracts as code and stays current with the API.

- **Gemini:** `@google/genai` — the provider's own SDK, including the
  `responseJsonSchema` structured-output mechanism used for extraction.
- **DeepSeek:** the **official OpenAI SDK** pointed at `https://api.deepseek.com`.
  DeepSeek publishes no SDK. It does publish an OpenAI-compatible API, and the
  brief explicitly allows "a compatible official SDK" for exactly this case.
  This is not a shortcut: it is the only official-SDK-family option, it is
  versioned like any dependency, and the DeepSeek-specific config (model,
  timeout, token cap, temperature, JSON output mode) is configured from
  `lib/ai/config.ts` through the same code shape as Gemini.

### 5.3 System prompts vs. user prompts

A **system prompt** fixes the role and the invariants for a model call and is
written by the application, not the user. A **user prompt** is the specific
input. There is exactly one written system prompt per role, kept next to the
code that uses it:

- `EXTRACTION_SYSTEM_PROMPT` (`lib/ai/extract.ts`): transcribe exactly, no
  paraphrasing, mark anything unreadable as `[illegible]`, never guess, respond
  as JSON matching the schema.
- the follow-up system prompt in `lib/ai/followup.ts`: refine without inventing
  facts, preserve meaning for the requested action (summarise/rephrase/expand),
  respond in the same structured JSON shape.

The only user-type content is the uploaded photo bytes and the chosen action —
the app never lets free-form user text steer a model prompt.

### 5.4 Model parameters, and why each is set

Every value is in `lib/ai/config.ts`, each with a one-line justification at the
point of definition. Summary (see the file for the full rationale):

| Parameter | Gemini (extraction) | DeepSeek (follow-up) | Why |
|---|---|---|---|
| Model | `gemini-3.6-flash` | `deepseek-chat` | current vision-capable flash tier (PRD's `2.5-flash` is retired — `problems.md` §2); general-purpose + language work |
| Timeout | 60 s | 45 s | one photo call measures 6–21 s with spikes (raised from 30 s after a real failure, `problems.md` §7); follow-up is text-gen, bounded below a normal completion |
| Max output tokens | 4096 | 2048 | one full page of notes; a refinement shouldn't exceed its source |
| Temperature | 0 | 0.4 | transcription must be deterministic; follow-up stays faithful with a touch of variance |
| Validation retries | 1 | 1 | one re-run after a schema failure, never an unbounded loop |

### 5.5 Structured output and schema validation (including the semantic check)

Structured output is requested from Gemini via a **real JSON Schema**
(`responseJsonSchema`), converted from the **same Zod schema**
(`lib/schemas/extraction-result.ts`) the reply is later re-validated against — so
the constraint asked of the model and the acceptance check are the same object
and cannot silently drift apart. DeepSeek is asked for JSON output mode and
re-validated against the same schema for the follow-up shape.

This project does **not** trust provider-side structured-output enforcement.
Every extraction result is re-validated in application code before it is stored
or shown. Validation here is two checks, run in order:

1. **Structural check (Zod):** does the reply match the schema — required
   `text`, shape of `keyPoints`/`sections`, types, constraints? A structurally
   invalid reply triggers a validation **retry** (≤ `validationRetries`) and
   then a clean FAILED row with a stored error message. This is the "what
   happens when validation fails" story: a defined retry budget, then an honest,
   user-visible failure — never raw model text masquerading as a result.
2. **Semantic check (`hasRealContent`):** after Zod passes, strip every
   `[illegible]` marker from `text`, `keyPoints`, and section headings/content,
   and see if anything real remains. If nothing does, the extraction is marked
   **FAILED** with a friendly message ("The photo couldn't be read clearly
   enough to extract any content..."), not DONE. A 95%-legible note with one
   unreadable word still passes (markers are preserved in the output as the
   model returned them); only a result with zero real content fails.

The semantic check exists because a schema-valid `{"text":"[illegible]"}`
completes the whole pipeline without any error, while producing nothing useful
— the same "200 doesn't mean success" trap the brief warns about, one layer up.
Zod makes DONE mean "well-formed"; `hasRealContent` makes DONE mean
"actually contains a transcription". The semantic check deliberately does not
trigger the schema-validation retry: an unreadable photo is a well-formed answer
to a different question (nothing to transcribe), so re-asking the model spends
money without fixing the input. Verified live both ways in
`scripts/evidence-illegible-policy.ts` and `problems.md` §4.

### 5.6 Jobs and workers

A **job** is one unit of work backed by a `Job` row: status
(`PENDING`/`PROCESSING`/`DONE`/`FAILED`), storage key (never the file), mime
type, attempts, extracted data, follow-up result, and `errorMessage`. The
**worker** is the process that picks units off the queue and advances the row
through its states; the row is the source of truth, the queue is the transport.
Any handler crash becomes FAILED with a real message, never a stuck PROCESSING.
A job lands FAILED if the provider rejects a photo, is slow past its timeout, or
returns unusable content — all recorded honestly and shown on the result screen.

### 5.7 Queues, FIFO, and why concurrency is capped

Uploading ten photos must not fire ten simultaneous paid model calls. The queue
decouples "accepted" from "processed": `POST /api/jobs` enqueues and returns,
the worker drains at a bounded pace. BullMQ's default ordering is roughly FIFO
for this single queue; ordering is a nice-to-have here, the **cap** is the
point. The worker's concurrency (`2`) is read from `lib/ai/config.ts.queue`
and enforced by BullMQ, not by hoping uploads arrive slowly. Because the cap is
the actual burst control at the provider level, the upload endpoint can keep its
separate per-IP rate limit for abuse control without pretending that *that* is
what stops cost spikes. The cap holding is demonstrated by
`scripts/verify-concurrency.ts` (enqueues 6 jobs, asserts max in-flight ≤ 2).

### 5.8 Rate limiting as cost control

Both cost-driving endpoints carry a per-IP sliding-window limit
(`lib/rate-limit.ts`): **10 uploads/min** (an enqueue can create many jobs in
one burst) and **5 follow-ups/min** (each is a paid DeepSeek call). This is
abuse control; the *cost* cap is the queue concurrency. Limits and windows are
configured in `lib/ai/config.ts`.

### 5.9 Why files live in object storage, not the database

Uploads are bytes that only ever need to be *read back once* by the worker.
R2 is engineered for exactly that; Postgres is not an object store, and storing
binary blobs there bloats backups, keeps connections busy copying bytes, and
mixes durable application state with large immutable assets. This is made
**structural**, not habitual: the locked `Job` schema has `storageKey String`,
and no file column, so the database physically cannot hold the raw file. The
local dev fallback (`.data/uploads/`) is a documented equivalent; the R2
round-trip is verified live (`problems.md` §6, `scripts/verify-storage.ts`).

### 5.10 The cost model — one run, and the caps on total spend

One extraction run sends the photo as image tokens + a small JSON-schema
request, and gets back up to 4096 output tokens; one follow-up sends the
extracted text and gets up to 2048 tokens. On flash-tier pricing these are
fractions of a cent each at typical sizes; exact per-token prices move, so the
numbers above are what to punch into the current Gemini/DeepSeek pricing pages
at submission time rather than a committed figure. What caps *spend* in this
slice, structurally: the queue concurrency (`2`) bounds simultaneous calls; the
rate limits bound bursts per user; timeouts and validation retries (≤1) bound
wasted call time; and the token caps bound per-call size. There is no unbounded
loop anywhere that can spend without a bounded number of provider calls.

The provider's own free-tier ceilings are a real, observed outer bound while the
keys are unpaid: Gemini's free tier allows **20 `generate_content` requests per
day per project per model** (`generate_content_free_tier_requests`), observed
live as `429 RESOURCE_EXHAUSTED` on 2026-09-17 when a final evidence pass ran a
handful of extra calls (problems.md §9b). That quota is a hard daily ceiling on
total spend from this slice — the app's concurrency/rate/timeout caps limit
*burst and waste*, the free-tier quota is what can stop the day's entire output
dead, and it resets per day. DeepSeek has no equivalent free tier to depend on;
its bound is the account balance (its `402 Insufficient Balance` history is in
problems.md §5).

## 6. Required evidence

Evidence is produced by real, un-mocked scripts under `scripts/` and real
provider calls. Run any with `node --env-file=.env --import tsx scripts/<name>.ts`.

| Required item | Where it's demonstrated |
|---|---|
| Jobs table: one success + one failure, message visible | `scripts/dump-jobs.ts`; real rows include `cmu4op0t8…` DONE (dur 5847 ms) and `cmu5bbdjt…` FAILED "The photo couldn't be read clearly enough…" (and `cmu5aa8vn…` FAILED on the 30 s timeout that prompted `problems.md` §7) |
| Requirement #10: provider timeout → defined fallback, on a real unstaged outage | `cmu5bessi0002qeq099c0g7ko` — FAILED at **61,036 ms** (60 s config timeout + ~1 s queue/DB overhead) with `"Gemini extraction timed out after 60000ms"` stored (full row in §6.2). Not a contrived test: Gemini genuinely hung past the new 60 s cap on a real photo on the morning evidence run, and the `withTimeout` wrapper (`lib/ai/extract.ts`) resolved the job cleanly instead of leaving it PROCESSING. The same run also produced three real 503 rows (`cmu5b7qz8…`, `cmu5b8hr2…`, `cmu5bh6s7…`) whose FAILED rows store the provider's raw `503 UNAVAILABLE` payload — the designed fallback path, exercised by a genuine outage |
| Raw model output alongside validated result | `scripts/verify-providers.ts` prints the raw Gemini reply next to the Zod-validated result, and re-parses the raw reply against the schema. When Gemini is flapping (transient 503s, §7), the same chain is proven by `scripts/evidence-illegible-policy.ts`, which shows the raw `[illegible]` reply becoming a FAILED row |
| Validation deliberately failing | `scripts/check-validation.ts` (5 malformed extraction + 4 malformed follow-up outputs rejected) plus the live noise-photo cases above — schema-compliant-but-empty is caught by the semantic check (§5.5) |
| Concurrency cap holding | `scripts/verify-concurrency.ts` — now hardens itself (problems.md §9c): runs on a per-run isolated queue, so a live production worker cannot contaminate it. Re-earned 2026-09-17 **with the production worker deliberately left running, and detected live during the run** (`live worker(s) on production queue "note-extraction": 1`): 6 jobs enqueued, max in-flight = **2** (configured cap), wall clock **12,160 ms**, exit 0 |
| Database holds only a storage key, not the file | `Job.storageKey` in every row (see dump); actual bytes only in R2 (or `.data/uploads/` in dev), never in Postgres — see §5.9 |
| Follow-up refinement via DeepSeek (summarise/rephrase/expand) | Real funded calls 2026-09-17 via `lib/ai/followup.ts`. e.g. on "MATH NOTES / 2X + 3 = 7 / X = 2": `summarise` → "Solve 2X + 3 = 7, giving X = 2."; `expand` → the full step-by-step solution (see §6.1) |
| Requirement #8: per-IP rate limits on BOTH cost-driving endpoints, live | `scripts/verify-rate-limits.ts` — real HTTP against the running app. Upload trips at **request 11** (> limit 10/60s) → `429` `{"error":"Too many attempts. Try again in 60 seconds."}` `Retry-After: 60`; follow-up trips at **request 6** (> limit 5/60s) → same 429 shape. Both buckets proven route-scoped/independent (§6.3) |

### 6.1 DeepSeek follow-up, real output (2026-09-17)

Funded key, via the production path (`lib/ai/followup.ts` → OpenAI SDK → `https://api.deepseek.com`), source text `"MATH NOTES\n2X + 3 = 7\nX = 2"`:

```
summarise → { "result": "Solve 2X + 3 = 7, giving X = 2." }
expand    → { "result": "MATH NOTES\n\nSolve the linear equation for X:\n\n2X + 3 = 7\n\nSubtract 3 from both sides:\n2X = 7 - 3\n2X = 4\n\nDivide both sides by 2:\nX = 4 / 2\nX = 2\n\nSolution: X = 2" }
```

Both completed in ~1.2 s, well inside the 45 s config timeout, and both re-validated
against the follow-up Zod schema before display.

### 6.2 Real unstaged provider outage → timeout fallback evidence (2026-09-17)

During the morning evidence run, Gemini genuinely hung past the (then-new) 60 s cap
on a real photo and returned `503 high demand` three times — no contrived test, no
staged failure. The full `dump-jobs.ts` rows, verbatim:

```
id           : cmu5bessi0002qeq099c0g7ko      ← the 60 s hang
status       : FAILED
attempts     : 1
errorMessage : Gemini extraction timed out after 60000ms
storageKey   : uploads/cmu5berh50000qeq00usi74pg/7fe414b6-93a6-4bae-9f0b-a8c45681c9e7.png
createdAt    : 2026-09-17T09:16:17.346Z
updatedAt    : 2026-09-17T09:17:18.382Z       ← 61,036 ms later: FAILED, not stuck PROCESSING

id           : cmu5aa8vn0004qei0yiuam2yc      ← the same mechanism, on the old 30 s cap
status       : FAILED
errorMessage : Gemini extraction timed out after 30000ms
createdAt    : 2026-09-17T08:44:45.299Z
updatedAt    : 2026-09-17T08:45:16.228Z       ← 30,929 ms later

id           : cmu5b7qz80005qe8sx8gw9w8b      ← real 503 high-demand (one of three)
status       : FAILED
errorMessage : {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
createdAt    : 2026-09-17T09:10:48.404Z
updatedAt    : 2026-09-17T09:10:52.582Z       ← FAILED on the provider error, message stored
```

Why this resolves cleanly: the provider call is raced against a timer at
`lib/ai/extract.ts:57` (`withTimeout`), configured from `aiConfig.gemini.timeoutMs`
— never a literal in the handler. When the race loses, the worker's catch path
writes `FAILED` + `errorMessage` (`lib/queue/worker.ts:73`), so a hung provider
call can never leave a row in PROCESSING. Same wrapper guards the DeepSeek
follow-up at `lib/ai/followup.ts:73`. The 503 cases resolve through the identical
path with the raw provider payload stored, which is the honest, user-visible
handling Requirement #10 asks for.

### 6.3 Rate limiting, real HTTP evidence — both buckets (2026-09-17)

Config (`lib/ai/config.ts.rateLimits`, per-IP sliding window of 60 s): upload
trigger **10/60 s** (`api-jobs-upload`), follow-up **5/60 s** (`api-jobs-follow-up`).
Verified live by `scripts/verify-rate-limits.ts` against the running app, with a
fresh TEST-NET-3 client IP per bucket so each starts empty. The gate runs before
auth by design, so requests that pass it and lack a session legitimately count
toward the bucket (401) — this is what stops unauthenticated abuse; storage and
enqueuing are only reached after auth, so no files were stored or jobs enqueued
by the upload trips.

```
=== PART 1: POST /api/jobs (upload trigger, limit 10/60s) ===
request  1..10: HTTP 401  {"error":"Sign in to upload notes."}   ← gate passed, no session
request    11: HTTP 429 Retry-After 60  ← GATE TRIPPED  {"error":"Too many attempts. Try again in 60 seconds."}

UPLOAD TRIP — the response on the request over the limit
HTTP status : 429
Retry-After : 60
body        : {"error":"Too many attempts. Try again in 60 seconds."}

=== PART 2: POST /api/jobs/[id]/follow-up (limit 5/60s) ===
request  1..5: HTTP 200  {"followUpType":"summarise","followUpResult":"…"}   ← real job, dedup path
request    6: HTTP 429 Retry-After 60  ← GATE TRIPPED  {"error":"Too many attempts. Try again in 60 seconds."}

FOLLOW-UP TRIP — the response on the request over the limit
HTTP status : 429
Retry-After : 60
body        : {"error":"Too many attempts. Try again in 60 seconds."}
```

Independence (buckets are keyed per-route, `{ip}:{route}` in `lib/rate-limit.ts`):

```
INDEPENDENCE A — upload bucket FULL on 203.0.113.51, follow-up on the SAME IP:
   HTTP 201 {"followUpType":"summarise",…}   ← succeeds; a shared bucket would 429 (10 ≥ 5)

INDEPENDENCE B — follow-up bucket FULL on 203.0.113.52, uploads on the SAME IP:
   upload requests 1..10: HTTP 401 (gate passed)   ← fresh upload bucket despite 5 follow-up hits
   upload request    11: HTTP 429                  ← trips at #11, not #6 as a shared bucket would
```

The follow-up test made exactly **one** real DeepSeek call: the first request
applied `summarise` (201), and the route's stored-result dedup answered the
rest (200) — the gate counted every request regardless. Both endpoints resolve
429 with the identical, user-visible body and a `Retry-After` equal to the
remaining window (60 s).

## 7. Honest disclosures

- **Gemini provider-flapping is real and visible in this slice.** Extraction
  has completed live many times this session (5–22 s typical), but the model
  intermittently returns `503 high demand` or exceeds the 60 s cap. The app's
  designed response — an honest FAILED row with the stored message, retry = a
  fresh upload — is exactly what happened during the 2026-09-17 evidence run
  (`problems.md` §5, §7). The noise-photo evidence is the interesting case here:
  when Gemini DOES reply, the semantic check fires; when it 503s, the row fails
  honestly upstream. Either way a noise photo is never DONE.
- **DeepSeek previously blocked by billing** (the `402 Insufficient Balance`
  recorded in `problems.md` §5) — resolved 2026-09-17, the account was funded
  and real follow-up calls now succeed (§6.1).
- **This document was created late** in the slice (2026-09-17) — it is a
  required deliverable that was missing; the concepts it documents had been
  recorded along the way in `problems.md` and inline comments.
- The PRD assumed `gemini-2.5-flash`; it is retired for new users, so
  `gemini-3.6-flash` is used (`problems.md` §2). 2.5-flash screenshots cannot be
  produced with a new API key.