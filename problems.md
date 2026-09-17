# Problems Log

## Phase 3 — discrepancies found while wiring real providers

### 1. `@google/genai@2.22.0` has no Zod-to-Gemini-schema helper
The PRD/rules assumed "structured output via the SDK's schema helper" exists
(`zodResponseSchema`). It does not exist anywhere in `@google/genai@2.22.0`
(dist checked: no `zodResponseSchema`/`schemaFromZod` export; the bundler only
carries an internal comment pointing at `zod-to-json-schema`).

**Chosen against it:** I did not hand-roll a schema converter, and I did not drop
to "JSON MIME type + prompt instruction" (which would weaken the structured-output
enforcement this project explicitly requires).

**Chosen:** added `zod-to-json-schema` (runtime dep) and convert
`lib/schemas/extraction-result.ts` to a JSON Schema at request time. Gemini
still receives a real JSON Schema constraint (`responseJsonSchema`), and the
provider's output is *still* re-validated against the same Zod schema in app
code before storage. The "single source of truth" property is preserved: the
schema that shapes the request is the same schema that revalidates the reply,
so the two cannot silently drift apart.

**Why this and not the alternatives:** the SDK can't express the constraint
natively anymore, so the cheapest faithful option is a maintained, version-pinned
converter invoked from the locked schema. If Google ships `zodResponseSchema`
again in a later 2.x, switch to it and delete the converter call — the Zod schema
file does not change either way.

### 2. `gemini-2.5-flash` is gone for new users (verified live)
PRD assumed `gemini-2.5-flash`. The real API rejects it with
`404 NOT_FOUND: "This model models/gemini-2.5-flash is no longer available to
new users... use models/gemini-3.6-flash"`.

**Chosen against it:** leaving the PRD dead-model in place (every real call 404s)
and switching to the Interactions API the error suggests (an unrelated API
surface; generateContent with a valid model is the documented core path and
keeps the whole slice on one call pattern).

**Chosen:** `aiConfig.gemini.model = "gemini-3.6-flash"`, approved by the user,
with a reasoned comment at the point of definition. The 2.5-flash name is on
record here rather than erased; if the assessment brief insists on 2.5-flash
screenshots, they are impossible to produce with a new API key.

### 3. Transpiled `crc32` from `node:zlib` passed a signed int32 under tsx
The evidence PNG encoder initially used `node:zlib`'s `crc32`. A direct node
check returned an unsigned number, but the same call under `tsx` produced a
negative value that blew up `writeUInt32BE`. Rather than fight a
transpiler/platform ambiguity in test plumbing, I replaced it with a local
table-driven IEEE CRC-32 (deterministic, portable). Worth recording because it
is the kind of silent sign quirk that only appears under a specific loader.

### 4. Unreadable-photo policy decided with the user (2026-09-16)
Live Gemini evidence: a pure-noise photo returned `{"text":"[illegible]"}`
which is schema-valid (min length 1), so the job would have been "DONE" while
carrying no information. The user chose the policy now implemented in
`extractionHandler`:
- Check for the ABSENCE of real content after stripping `[illegible]` markers,
  NOT the mere presence of a marker. A 95%-legible note with one unreadable
  word stays DONE (markers included, as the model returned them).
- Only when every meaningful field (text, keyPoints, section headings/content)
  reduces to empty/whitespace after stripping → FAILED, with a clear message:
  "The photo couldn't be read clearly enough to extract any content — try a
  clearer or better-lit photo."
Rejected alternative: failing on marker presence, which would fail exactly the
legible-with-a-gap case this product should keep.

The reasoning that justifies this as a second, *semantic* check (not a stricter
schema): a DONE job with no real content is the same "200 doesn't mean success"
problem the brief warns about, one layer up. The pipeline can complete without
erroring — worker ran, provider replied, schema passed — while the job has
produced nothing useful. `DONE` is only a meaningful signal if it means "the
job did useful work", not merely "nothing crashed". Zod validates shape
(structural); `hasRealContent` validates that actual meaning survived (semantic).
The two run in that order, and the semantic check deliberately does NOT trigger
the schema-validation retry: a wholly-illegible photo is a well-formed answer
to the wrong question (nothing to transcribe), so re-asking the model costs
spend without ever fixing the input.

### 5. Provider-side behaviours observed live (and one Windows environment quirk)
- Gemini `gemini-3.6-flash` (real key, 16–17 Sep 2026): extraction works and
  respects `responseJsonSchema`. It occasionally returns transient 503
  "high demand… try again later" (observed twice). The app already treats any
  handler error as a FAILED row with the message stored, which is the designed
  response to this — a retry is a fresh upload. No schema-level failure has
  been observed on real output yet.
- DeepSeek (real key): the request path works (reaches DeepSeek's edges, real
  trace IDs back) but the account returns `402 Insufficient Balance` — billing
  is the blocker for a successful follow-up result, not the code. The user will
  top up and we re-run the follow-up evidence (tomorrow).
- Windows environment artifact: standalone `node --import tsx` CLI scripts that
  exit while a provider socket is still draining occasionally print
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` from libuv after the
  real error is already reported. Benign, seen only in dev test scripts that
  `process.exit()` mid-flight; does not affect the running Next app or worker.

### 6. Going live against real Cloudflare R2 (verified 2026-09-17)
Real `R2_*` values in `.env` flipped the storage backend to R2, and three real
failures surfaced before the round-trip passed:
- **Virtual-hosted vs path-style addressing.** The AWS SDK defaulted to
  virtual-hosted URLs, making the SDK request `bucket.<account>.r2...`, which
  R2 does not serve (ENOTFOUND). Fixed with `forcePathStyle: true`. This is an
  SDK default mismatch, not a config error.
- **`R2_ENDPOINT` shape.** The first endpoint the user entered contained the
  bucket as a host prefix (`https://ai-slice.<account>.r2.cloudflarestorage.com`).
  The R2 S3 endpoint is `<account>.r2.cloudflarestorage.com` only; the SDK
  receives the bucket separately (`R2_BUCKET_NAME`).
- **Machine-local DNS quirk (root cause not fully pinned).** After the endpoint
  was corrected, `PutObject` still failed with `getaddrinfo ENOTFOUND` for the
  account hostname, even though `nslookup`/PowerShell and a plain
  `https.request` to the same host from the same Node process resolved it fine.
  Intercepting every socket `lookup` and routing it through `node:dns.lookup`
  made the identical request succeed, so `r2.ts` now pins an `https.Agent`
  whose `lookup` does exactly that. Honest status: the evidence points at the
  internal net-level `getaddrinfo({all:true})` call failing on this machine for
  this host, but I could not get a repro from the public `dns` API — the fix is
  verified, the mechanism is only inferred, not proven.

**Chosen against it:** doing nothing once `forcePathStyle` "didn't help" (both
failures were real and both had to be fixed for R2 bytes to round-trip), and
patching `net` monkey-patch-wide (the agent-level `lookup` scopes the change to
exactly the R2 client).

### 8. DeepSeek billing unblocked; the day's live-provider flap (2026-09-17)
The follow-up path stopped being 402-blocked: the user funded the account and
real `summarise`/`expand` calls succeeded in ~1.2 s each (recorded in
DOCUMENTATION.md §6.1). §5 stands as the historical record of the blockage.

The same day, Gemini repeatedly returned `503 high demand` and once hung past
the (new) 60 s cap on the *same* requests that had succeeded minutes earlier in
5–22 s — provider capacity, not a config mistake. Worth recording because it
made evidence runs non-deterministic: the noise-photo case passed cleanly twice
(semantic check fired on a real `[illegible]` reply) and failed upstream twice
(503/timeout). The invariant held either way — a noise photo is never DONE —
and the evidence script was adjusted to assert that invariant while reporting
which path fired, instead of insisting on the message path. Also fixed while in
here: signin/signup/verify redirected to a `/dashboard` that doesn't exist
(now `/upload`), `/` redirects to `/upload`, and the `/dashboard` entry was
removed from `proxy.ts`.

### 7. The 30s Gemini timeout was too tight for real photo latency (2026-09-17)
A real upload failed with "Gemini extraction timed out after 30000ms". Probing
the exact same stored photo through the same request path showed the call
succeeds in **20.6s** and the R2 read adds ~2s on top — while the two earlier
DONE jobs had finished in ~6s. Latency for one vision call therefore swings
6s → 21s → past 30s, and the old cap failed a legitimate slow run.

**Chosen:** `aiConfig.gemini.timeoutMs` 30_000 → 60_000 (config only, never a
handler-side value), justifying the change at the point of definition.

**Chosen against:** adding a retry-on-timeout. It would double the cost of every
slow-but-successful call, and the SDK has no abort signal so the orphaned first
attempt keeps billing in the background either way (see the `withTimeout` note
in `lib/ai/extract.ts`). A background job can afford to wait 60s for a
correct answer; it cannot afford to double-spend. If Gemini latency keeps
climbing past 60s, that is a provider-capacity problem worth flagging, not a
timeout knob worth turning again.

### 9. Post-review verification: timeout held on a real hang; quota & queue-sharing flakes (2026-09-17)

Three findings from the final evidence pass:

**9a. The 60s timeout mechanism is confirmed against a real, unstaged hang — no bug.**
Job `cmu5bessi0002qeq099c0g7ko` (a real upload, real photo) resolved `FAILED` at
**61,036 ms** after creation — created `09:16:17.346Z`, updated `09:17:18.382Z`
— with `errorMessage: "Gemini extraction timed out after 60000ms"` and
`attempts: 1`. It did **not** stay PROCESSING: the `withTimeout` race
(`lib/ai/extract.ts:57`) rejected, the worker catch path wrote FAILED+message
(`lib/queue/worker.ts:73`). The three 503 rows from the same morning
(`cmu5b7qz8…`, `cmu5b8hr2…`, `cmu5bh6s7…`) also resolved FAILED storing the raw
`503 UNAVAILABLE` payload. Evidence captured in DOCUMENTATION.md §6.2.

**9b. Gemini free-tier daily quota is a real wall (observed during final pass).**
`scripts/verify-providers.ts` step 1 (extraction) and step 3 (DeepSeek
follow-up) passed clean on real keys, and the raw-vs-validated gate printed
PASS. Step 2 (pure-noise photo) was rejected *upstream* by
`429 RESOURCE_EXHAUSTED` — the free-tier per-model daily cap
(`generate_content_free_tier_requests`, limit 20/day) is exhausted by repeated
evidence runs on one key. The semantic-check invariant is unaffected: it is
already proven by earlier real `[illegible]` rows (`cmu4prlac…`, `cmu5b7kic…`,
`cmu5bbdjt…`, `cmu5bil11…`). Not a code issue; the key is free-tier and the
limit is per-day.

**9c. `verify-concurrency.ts` is only valid when its worker owns the queue alone.**
Two of its runs (09:40 and my 10:17 re-run) split the 6 dummy jobs with a
second consumer on the same `note-extraction` queue: the inline tracking handler
saw only ~2 (DONE, 4 s sleep each), and the other 4 went to a live real-handler
worker, failing fast on R2 with "The specified key does not exist." The script
then times out waiting for all six.

**Post-review: this was re-earned, not trusted as-is.** The previously-captured
09:42 clean run (12.2 s, max 2, exit 0) cannot be proven isolated retroactively:
no historical process list survives, and the runs immediately either side of it
(09:40 split, 10:17 split) had a live worker on the queue. It may well have been
clean *by luck* (the worker down at that exact moment), which is not a
reproducible guarantee. So it was superseded rather than kept.

**Hardening applied (`scripts/verify-concurrency.ts`):** the test now runs on a
per-run, dedicated queue name (`note-extraction-concurrency-<timestamp>`), so a
live production worker structurally cannot pick up its jobs. `startWorker`
gained an optional queue-name parameter in `lib/queue/worker.ts` (default =
production queue; production callers unchanged). The script also reports
`Queue#getWorkers()` (Redis `CLIENT LIST`) on the production queue, so a proof
run shows the live worker count while running.

**Chosen against — option (a), detecting a live consumer and refusing to run:**
refusing is a TOCTOU race (a worker can attach *during* the run, so it cannot
guarantee the isolation it claims) and its only evidence is a refusal message.
Isolating the queue makes contamination structurally impossible and yields a
pass-with-worker-attached as proof. Worth recording because "check first, then
run" sounds sufficient and is not.

**Re-earned evidence (2026-09-17, with the production worker deliberately left
running and detected live during the run):** 6 jobs on the isolated queue, max
in-flight = 2 (cap), wall clock 12,160 ms, exit 0 — `live worker(s) on
production queue "note-extraction": 1`, and all 6 dummy jobs still completed in
clean 4 s/8 s/12 s pairs. This is now the final evidence in DOCUMENTATION.md §6,
replacing the unprovable 09:42 run.

**9d. Rate-limit evidence must control the client IP explicitly (2026-09-17).**
`getClientIp()` (`lib/rate-limit.ts`) resolves `x-forwarded-for` first, then
`x-real-ip`, then falls back to `"unknown"`. Direct localhost requests carry no
forwarding header, so every local client collapses into one `"unknown"` bucket
per route — which is correct for a single-machine dev setup but makes live
evidence non-deterministic if earlier manual testing already filled a bucket.
`scripts/verify-rate-limits.ts` therefore sends a fresh TEST-NET-3 address in
`X-Forwarded-For` per bucket so each run starts empty and is reproducible. In a
real deployment the IP is set by the load balancer/proxy and this is a non-issue;
the script's behaviour just mirrors production keying. Noted here because
"the limiter is wired in" looked trivially true and the live evidence still
needed a deterministic harness.