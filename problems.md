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