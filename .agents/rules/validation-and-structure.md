# Validation & Structure Rules — Assessment 3

## Upload Validation

- The upload form has one Zod schema (`lib/schemas/upload.ts`) covering file type and size, shared between client-side feedback and the server-side check on the `/api/jobs` route. Client-side validation is never treated as sufficient on its own.
- Real restrictions are enforced, not just described in the UI: a file over the size limit, or of the wrong type, is rejected server-side even if the client-side check was somehow bypassed.

## Testing Inputs

- Test with more than clean, well-formed inputs before calling upload handling done: an empty file, a corrupted file, and a file at the exact size limit all need to be tried, not just typical cases. This is explicitly called out as a trap in `PRD.md` because it's the kind of thing that's easy to skip under time pressure.

## Accessibility (the one UI requirement that's graded)

- Every input has a label programmatically bound to it.
- Default focus outlines stay visible unless replaced by an equally visible custom style.
- No design system, no custom component library, no visual branding work.

## Scope Discipline

- If a task isn't listed in `PRD.md`, don't build it — no editing the extracted result, no history of past uploads, no export. Flag it instead of adding it silently.
- The follow-up action is exactly one user-triggered action per result (summarise, rephrase, or expand — pick one, or offer a small fixed choice) — not a general-purpose chat interface bolted onto the result.

## Error Handling on the Processing Path

- The processing state screen never shows a blank or ambiguous state — it reflects `PENDING`, `PROCESSING`, `DONE`, or `FAILED` explicitly, and a `FAILED` state shows the user something honest, not a generic spinner that never resolves.
- If the queue or Redis itself is unreachable, the upload endpoint fails clearly rather than accepting the upload and silently never processing it.

## Environment & Secrets

- `.env.example` lists every environment variable by name with a comment on where its real value comes from (Gemini API key, DeepSeek API key, R2 credentials, Redis connection string) — no real values, ever.
- The agent does not write real secrets into `.env` under any circumstance.

## Commit Hygiene

See `rules/git.md`.
