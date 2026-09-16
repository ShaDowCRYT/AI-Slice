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