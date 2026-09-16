# PRD — Assessment 3: The AI Integration Slice

## Overview

A single AI-powered flow: a user uploads a photo of handwritten notes, a background job extracts structured text via a real model, and the result appears. One user-triggered follow-up action refines that result via a second model. This is a single slice — not an application.

**Domain:** handwritten notes → structured text (assumption — flag if a different domain is wanted)
**Stack:** Next.js / TypeScript / Prisma / PostgreSQL / BullMQ + Redis / Cloudflare R2
**Models:** Gemini (extraction/vision role) via `@google/genai`; DeepSeek (follow-up role) via the official OpenAI SDK pointed at DeepSeek's API — DeepSeek has no SDK of its own, so this is a documented, deliberate use of a compatible official SDK, per the brief's own allowance for this case
**Time budget:** 18–22 hours
**Deadline:** Wednesday, 17 September 2026

## Screens (exactly these, nothing more)

1. Upload view — accepts one or more files, with real size and type restrictions enforced
2. Processing state — honestly reflects pending / processing / done / failed
3. Result view — shows the structured output
4. One user-triggered follow-up action on the result (summarise, rephrase, or expand)

You may reuse the authentication slice from Assessment 1. State this explicitly in `DOCUMENTATION.md` if done.

## Behaviour (acceptance criteria)

- [ ] Upload triggers a background job, not a blocking request
- [ ] Two distinct roles are served by two different models — Gemini for extraction, DeepSeek for the follow-up action
- [ ] The extraction output is structured data, requested via schema and validated in application code on receipt — not free text parsed with string operations
- [ ] Failures are recorded in the job record and visible to the user, honestly

## Explicitly Out of Scope — do not build

- No landing page
- No account system beyond what's needed for a signed-in user (Assessment 1 reuse is fine)
- No editing, sharing, or exporting of results
- No features beyond the one flow

## Engineering Requirements (all must be present and documented)

1. Official SDKs only — `@google/genai` for Gemini; the official OpenAI SDK pointed at DeepSeek's endpoint for DeepSeek, since DeepSeek has no SDK of its own (documented explicitly in Section 5)
2. API keys written into `.env` by hand — never by the agent
3. A config file (`lib/ai/config.ts`) holding every changeable value: model identifiers, timeouts, output token caps, temperature, rate limits, concurrency cap — nothing hardcoded in a handler
4. A written system prompt per role, with each parameter justified in one line
5. Structured output requested via schema, validated again in application code on receipt (Zod), with a defined retry and a defined graceful failure
6. A job record in the database for each unit of work — status, attempts, error message on failure
7. A queue with a concurrency cap, so uploading many files doesn't fire many simultaneous provider calls
8. Rate limiting on the endpoint that triggers processing and on the follow-up action
9. Files in Cloudflare R2 (or a documented local dev equivalent) — only the storage key in the database, never the file itself
10. A timeout on every model call, with a defined fallback behaviour

## Data Model (Locked)

This is the schema. Do not add, remove, or rename tables or fields, and do not change a constraint, without flagging it first.

```prisma
enum JobStatus {
  PENDING
  PROCESSING
  DONE
  FAILED
}

model Job {
  id             String    @id @default(cuid())
  userId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  status         JobStatus @default(PENDING)
  storageKey     String
  mimeType       String
  extractedData  Json?
  followUpType   String?
  followUpResult String?
  attempts       Int       @default(0)
  errorMessage   String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([userId])
  @@map("jobs")
}
```

**Why each locked constraint is what it is:**

- `status JobStatus` — an explicit enum, not a boolean or a string, so `PENDING`/`PROCESSING`/`DONE`/`FAILED` are the only representable states. This is what makes the processing screen's "honestly reflects" requirement enforceable at the type level, not just a UI convention.
- `storageKey String`, no file column — the database physically cannot hold the raw file, which is what makes requirement #9 structural rather than a habit to remember.
- `attempts Int` + `errorMessage String?` — a failed job says why it failed and how many times it was tried, which is what requirement #6 actually asks for, not just a pass/fail flag.
- `extractedData Json?` holds the validated, structured extraction result — not the raw model output. The raw output is not persisted by design (see Section 5's structured-output concept); what's stored is what survived validation.
- `followUpType` / `followUpResult` live on the same `Job` row rather than a separate table — the follow-up action operates on an already-completed job's result, is a single synchronous user-triggered action rather than a queued bulk operation, and doesn't need its own status/attempts tracking the way the extraction job does. This is a deliberate scope decision, documented in Section 5.

The agent implements types, indexes, and migration details against this shape — it does not redesign the shape itself. If a requirement seems to need a field or table not listed here, stop and flag it before adding one.

## Concepts to Document (Section 5 of DOCUMENTATION.md)

What an API endpoint is. SDKs vs. raw HTTP, and why official SDKs — including the DeepSeek-via-OpenAI-SDK decision specifically. System prompts vs. user prompts. Model parameters set, and why each one. Structured output and schema validation, including what happens when validation fails. Jobs and workers. Queues, FIFO, and why concurrency is capped. Rate limiting as a cost control. Why files live in object storage rather than the database. The cost model — what one run costs, and what caps total spend.

## Required Evidence (for DOCUMENTATION.md)

- Jobs table showing one successful run and one failed run, with the error message visible on the failed one
- The raw model output for one request, alongside the validated, parsed result
- Evidence of what happens when validation is deliberately made to fail
- The concurrency cap holding — enough files uploaded at once to demonstrate the provider request pattern doesn't spike
- A screenshot showing the database holds only a storage key, not the file

## Grading Bands (self-check before submission)

**Pass:** upload triggers a background job, both roles are served by their respective models, output is structured and validated, failures are recorded, keys and config are handled correctly.

**Excellent:** validation happens in application code, not just relying on provider-side schema enforcement; the failure path is a designed user experience, not a raw error string; the cost model has real numbers; the concurrency cap is demonstrated, not just asserted.

## Known Traps (avoid these)

- Letting an agent write API keys
- Hardcoding a model name or token limit directly in a handler instead of the config file
- Parsing prose with string operations instead of requesting structured output
- Testing only with clean inputs — never an empty file, a corrupted file, or one at the exact size limit
- Storing the uploaded file itself in the database
- Believing a 200 response means the work succeeded — the work happens in the job, and the job is where failure actually lives
