# Security Rules — Assessment 3

These are enforceable, not aspirational. Every rule below maps directly to a graded engineering requirement.

## API Keys and SDKs

- `GEMINI_API_KEY` and `DEEPSEEK_API_KEY` are added to `.env` by the human, by hand — the agent never writes a real value into any file.
- Only official SDKs are used: `@google/genai` for Gemini, the official `openai` package pointed at `https://api.deepseek.com` for DeepSeek. No hand-rolled HTTP clients against either provider's REST API.

## Configuration

- Every changeable value — model identifiers, timeouts, output token caps, temperature, rate limits, concurrency cap — lives in `lib/ai/config.ts`. A value hardcoded anywhere else (a route handler, a service file) is a rule violation, not a style nitpick, because it's what requirement #3 is explicitly checking for.
- Each system prompt (`lib/ai/extract.ts`, `lib/ai/followup.ts`) is a written, named constant, not assembled inline at call time. Each parameter set alongside it (temperature, max tokens) has a one-line comment justifying the choice.

## Structured Output

- The extraction result is requested from Gemini using its structured-output/schema feature — not free text the application then parses with string operations or regex.
- Whatever comes back is re-validated against the same Zod schema (`lib/schemas/extraction-result.ts`) in application code before it is stored or shown. Provider-side schema enforcement is not treated as sufficient on its own.
- A validation failure has a defined retry (at most one, with a clear limit — not an unbounded loop) and a defined graceful failure: the job is marked `FAILED` with a real `errorMessage`, never left in an ambiguous state.

## Jobs and the Queue

- Every upload creates a `Job` row before any model call happens. The row is the source of truth for status — `PENDING` on creation, `PROCESSING` when the worker picks it up, `DONE` or `FAILED` when it finishes.
- The upload endpoint returns immediately after creating the job and enqueuing it. It never blocks waiting for the model call to complete.
- The queue worker's concurrency is capped by a value read from `lib/ai/config.ts` — uploading many files at once must not fire many simultaneous provider calls. This is the single most load-bearing requirement in this assessment and must be demonstrated, not just implemented.

## Timeouts

- Every call to Gemini or DeepSeek has an explicit timeout, read from `lib/ai/config.ts`. A hung provider call cannot hang a job indefinitely.
- A timed-out call has a defined fallback — the job is marked `FAILED` with an `errorMessage` describing the timeout, same as any other failure path. It is never left `PROCESSING` forever.

## Storage

- The uploaded file is written to Cloudflare R2 (or a documented local dev equivalent — e.g. local disk with the same interface, clearly noted as a dev-only substitute). Only the resulting storage key is written to `Job.storageKey`.
- No code path ever writes file bytes into Postgres, logs the file's raw content, or returns the raw file bytes from an API route.

## Rate Limiting

- The job-creation (upload-trigger) endpoint and the follow-up-action endpoint are each rate-limited independently, per user/IP, using the same in-memory pattern from prior assessments.
- A rate-limited request returns HTTP 429 with a retry indication.

## Never do this

- Never let a raw provider error (a Gemini or DeepSeek SDK exception) reach the client — every failure path returns a clean, generic message, and the real detail goes into `Job.errorMessage`.
- Never assume a 200 from the upload endpoint means the extraction succeeded — it only means the job was created and enqueued.
- Never commit `.env`. Only `.env.example` with placeholders is committed.
