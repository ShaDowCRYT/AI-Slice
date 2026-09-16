# AGENTS.md — Assessment 3: AI Integration Slice

## What is this project?

A single, narrow slice: upload a photo of handwritten notes, a background job extracts structured text via Gemini, and a user-triggered follow-up action (summarise/rephrase/expand) refines it via DeepSeek. This is not the start of a larger app. Full scope, screens, and the locked job schema are in `PRD.md`. Read it before writing any code.

## What is Locked

- **Stack:** Next.js (App Router) + TypeScript, Prisma + PostgreSQL, BullMQ + Redis for the job queue, Cloudflare R2 for file storage, Zod for validation.
- **Models:** Gemini via `@google/genai` for extraction (pin below 3.0.0 unless on Node 22+). DeepSeek via the official OpenAI SDK pointed at `https://api.deepseek.com` for the follow-up action — DeepSeek has no SDK of its own; this is a deliberate, documented use of the brief's "compatible official SDK" allowance, not a shortcut.
- **Screens:** exactly the four listed in `PRD.md` — upload, processing state, result, one follow-up action. No others.
- **Data model:** the `Job` model in `PRD.md`'s "Data Model (Locked)" section — do not redesign this shape.
- **Engineering requirements:** every constraint in `rules/security.md`, `rules/validation-and-structure.md`, and `rules/git.md` is locked.
- **Auth reuse:** Assessment 1's authentication may be reused, but this must be stated explicitly in `DOCUMENTATION.md`.

## What must never happen

- Never build a landing page, extra account features, or editing/sharing/exporting on the result — one flow, nothing else.
- Never store the uploaded file itself in Postgres, in any form — only the R2 storage key.
- Never trust a provider's structured-output enforcement alone. Every extraction result is re-validated against the Zod schema in application code before it's stored or shown.
- Never let an upload fire an unbounded number of simultaneous provider calls. The concurrency cap in `lib/ai/config.ts` is enforced by the queue, not by hoping uploads arrive slowly.
- Never hardcode a model name, temperature, token cap, timeout, or rate limit inside a route handler or service file — every one of those values lives in `lib/ai/config.ts` and is imported, not restated.
- Never write a real API key into any file. The human adds real values to `.env` by hand.
- Never commit `.env`.
- Never skip logging a real problem in `problems.md` because it's embarrassing.

## How is the work arranged?

```
/app
  /(app)
    /upload
    /jobs
      /[id]
/app/api
  /jobs
    /route.ts
    /[id]
      /route.ts
      /follow-up
        /route.ts
/lib
  /ai
    config.ts
    gemini.ts
    deepseek.ts
    extract.ts
    followup.ts
  /queue
    queue.ts
    worker.ts
  /storage
    r2.ts
  /schemas
    upload.ts
    extraction-result.ts
  rate-limit.ts
/prisma
  schema.prisma
proxy.ts
problems.md
.env.example
DOCUMENTATION.md
```

Maintain `problems.md` continuously, not retroactively — same discipline as every prior assessment.

## How should the code look?

- `lib/ai/config.ts` is the single source of truth for every changeable value across both models — model IDs, timeouts, token caps, temperature, rate limits, concurrency. Every other file imports from it; none restate a value.
- `lib/schemas/extraction-result.ts` is the schema the extraction output is validated against — used both when requesting structured output from Gemini and when validating what comes back, so the two can't silently drift apart.
- `lib/ai/extract.ts` and `lib/ai/followup.ts` each hold one written system prompt for their role, with a one-line comment justifying each parameter set (temperature, token cap) at the point it's set — not just described in documentation after the fact.
- The queue worker (`lib/queue/worker.ts`) is where the concurrency cap actually lives — configured from `lib/ai/config.ts`, not a magic number in the worker file itself.
- No design system, no custom component library. Plain Tailwind utilities or a lightweight primitive kit is enough.
- Incremental commits as features land, per `rules/git.md`.

## What counts as done?

A task is not done when it works. It is done when all three are true:

1. It works, per the acceptance criteria in `PRD.md`.
2. It satisfies the relevant rule in `rules/security.md`, `rules/validation-and-structure.md`, or `rules/git.md`.
3. There's a note (inline comment or `problems.md`) capturing why this approach was chosen over the alternative — this is the raw material for Section 5's "what I chose against" question, especially relevant here since two providers with different SDK situations are involved, and the reasoning behind that split needs to be ready to explain, not assumed obvious.

## What does the agent do when unsure?

- If a task seems to fall outside the four screens or the stated behaviour in `PRD.md`, stop and flag it rather than guessing and building it anyway.
- If Gemini's or DeepSeek's actual current API behavior doesn't match what was assumed when `PRD.md` was written (model names and API shapes for both providers move quickly), stop and flag the specific discrepancy rather than silently substituting something that looks similar.
- If there's a genuine choice between two valid approaches, state the tradeoff explicitly before implementing, choose the one that best satisfies `PRD.md`'s stated requirements, and record the rejected alternative in `problems.md` or inline.
- If a rule in `rules/` seems to conflict with something faster or simpler to build, the rule wins. Flag the tension rather than quietly working around it.
- If genuinely blocked, surface the blocker early rather than working around it silently.
