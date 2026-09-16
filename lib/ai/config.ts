// Single source of truth for every changeable value across both providers and
// the queue. Every other file imports from here — no value is restated in a
// route handler, service, or worker.

export const aiConfig = {
  gemini: {
    // gemini-3.6-flash is the current vision-capable flash tier (verified live
    // 2026-09-16; gemini-2.5-flash — the PRD's assumed model — now returns 404
    // "no longer available to new users". See problems.md). Supports
    // responseJsonSchema structured output and reliably reads handwriting.
    model: "gemini-3.6-flash" as const,
    // 30s ceiling on one extract call: generous for a photo job, but a hung
    // provider call longer than this is treated as a failure, not something
    // the job waits on forever.
    timeoutMs: 30_000,
    // 4096 output tokens caps the extracted text of a full page of notes
    // without truncating a realistic page; larger inputs are out of scope.
    maxOutputTokens: 4096,
    // 0 — extraction is transcription: deterministic, so identical input
    // yields identical output, and the schema decides structure, not the
    // model's mood.
    temperature: 0,
  },
  deepseek: {
    // deepseek-chat is DeepSeek's general-purpose model; summarise/rephrase/
    // expand needs language facility, not deep reasoning.
    model: "deepseek-chat" as const,
    // 45s — the follow-up is a longer text-generation call than extraction;
    // this bounds it without cutting off a normal completion.
    timeoutMs: 45_000,
    // 2048 tokens — a refined/summarised result shouldn't exceed the source
    // notes' own budget; caps runaway generation.
    maxOutputTokens: 2048,
    // 0.4 — low but not zero: the follow-up should stay faithful to the
    // source, while a touch of variance avoids wooden, verbatim repetition.
    temperature: 0.4,
    // Same discipline as extraction: re-run once if the reply fails the Zod
    // check, so one malformed JSON frame doesn't doom an otherwise good job.
    validationRetries: 1,
  },
  extraction: {
    // Re-run the extract once if the first response fails schema validation;
    // at most one retry, never an unbounded loop that burns provider quota on
    // input the model repeatedly can't shape.
    validationRetries: 1,
  },
  rateLimits: {
    // 10 uploads/min/IP — the upload endpoint can enqueue many jobs in one
    // burst, so it's the primary check on provider cost and storage abuse.
    uploadTrigger: { limit: 10, windowMs: 60_000 },
    // 5 follow-ups/min/IP — each is a paid DeepSeek call; tighter than the
    // upload bucket so a stuck user can't silently exhaust the token budget.
    followUp: { limit: 5, windowMs: 60_000 },
  },
  queue: {
    // Hard cap on simultaneous provider calls across all jobs. 2 stays within
    // free-tier rate limits for both Gemini and DeepSeek while leaving one
    // slot free to survive a stall during a retry.
    concurrency: 2,
  },
} as const;