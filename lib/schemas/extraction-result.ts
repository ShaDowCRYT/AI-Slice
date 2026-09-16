// The Zod schema the Gemini extraction output is validated against. It is this
// schema — not the prompt, and not a free-text convention — that defines the
// shape Gemini must produce: the same schema is passed to Gemini when
// requesting structured output and used to re-validate whatever comes back, so
// the two can never silently drift apart.
//
// Deliberately not .strict(): the model's response sometimes carries harmless
// extra keys, and failing an entire job because of an unknown field would be
// brittler than stripping unknowns. Structure is enforced by the required
// fields and the limits below.

import { z } from "zod";

export const extractionResultSchema = z.object({
  // A short inferred caption from the first line/heading of the notes.
  title: z.string().max(200).default("Untitled notes"),
  // The full extracted text — the primary payload, and what the follow-up
  // action operates on. Must be non-empty: an empty extraction is a failure,
  // not a valid result.
  text: z.string().min(1).max(20_000),
  // Optional segmentation into headed sections when the notes are structured.
  // Optional because a scribbled single block or a diagram-heavy page often
  // has no usable headings — forcing it would manufacture fake structure.
  sections: z
    .array(
      z.object({
        heading: z.string().max(200),
        content: z.string().max(10_000),
      }),
    )
    .max(50)
    .optional(),
  // Optional high-level takeaways, when the notes express any.
  keyPoints: z.array(z.string().max(500)).max(20).optional(),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;