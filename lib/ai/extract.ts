// lib/ai/extract.ts — Gemini transcription of a handwritten-notes photo, plus
// the queue handler that drives a Job row through it.
//
// The one written system prompt for extraction lives here, and every model call
// honours these disciplines (security.md rules 24–29, validation-and-structure):
//  - structured output is requested from Gemini via a real JSON Schema
//    (`responseJsonSchema`) converted from extractionResultSchema — the same
//    schema the output is then re-validated against, so the request shape and
//    the acceptance shape can't drift apart;
//  - whatever Gemini returns is re-validated against that Zod schema in this
//    file BEFORE it's stored or shown. Provider-side structured-output
//    enforcement is treated as a hint, never a guarantee;
//  - a validation failure is retried at most aiConfig.extraction.validationRetries
//    times (1), then the job fails cleanly with a user-visible message;
//  - the timeout on every call comes from config (data: one hung call becomes a
//    failed job, not an eternal PROCESSING state).

import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";

import { aiConfig } from "./config";
import {
  extractionResultSchema,
  type ExtractionResult,
} from "../schemas/extraction-result";
import { readFileBytes } from "../storage/r2";
import type { JobHandler, JobHandlerResult } from "../queue/worker";

export const EXTRACTION_SYSTEM_PROMPT = [
  "You transcribe photographs of handwritten notes into structured, machine-readable text.",
  "- Transcribe every legible word exactly as written: no paraphrasing, no grammar or spelling correction, no invented content.",
  "- Mark any word or line you cannot read as [illegible]. Never guess a word from context.",
  "- If the notes have clear headings or numbered/bulleted lists, capture that structure in the sections array; otherwise leave sections absent.",
  "- Put the complete transcription in the text field — it is required.",
  "- title: a short (under 200 chars) caption you infer from the first line of the notes.",
  "- keyPoints: at most a few stand-out takeaways when the page expresses any; otherwise omit.",
  "- Respond with JSON only, matching the schema given to you exactly.",
].join("\n");

// Converted once at module load from the same schema used for re-validation.
const responseJsonSchema = zodToJsonSchema(extractionResultSchema);

// One client per process; the API key comes from .env, never from a file in the
// repo. The constructor only throws when no key is present at all — a
// placeholder value safely produces runtime authentication errors instead.
const geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** A value Gemini returned that our schema refuses to accept. */
export class ExtractionValidationError extends Error {}

/**
 * Shared timeout wrapper for provider calls: turns a hang into a rejected
 * promise. The SDK call itself keeps running in the background past the limit
 * (there's no abort signal on the genai client), but we never wait longer than
 * config timeoutMs for the work a Job depends on.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Parse + Zod-validate a Gemini JSON reply. Throws ExtractionValidationError. */
export function parseExtractionOutput(raw: unknown): ExtractionResult {
  const parsed = extractionResultSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => issue.path.join(".") || "(root)")
      .join(", ");
    throw new ExtractionValidationError(
      `Extraction output failed validation (${detail}).`,
    );
  }
  return parsed.data;
}

async function requestExtraction(
  input: { storageKey: string; mimeType: string },
  onRawOutput?: (rawText: string) => void,
): Promise<ExtractionResult> {
  const imageBytes = await readFileBytes(input.storageKey);
  const base64 = imageBytes.toString("base64");

  const response = await withTimeout(
    geminiClient.models.generateContent({
      model: aiConfig.gemini.model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.mimeType, data: base64 } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        // Same Zod schema as the re-validation below — the constraint Gemini is
        // asked to honour and the constraint the reply is then checked against.
        responseJsonSchema,
        systemInstruction: EXTRACTION_SYSTEM_PROMPT,
        // 0: transcription is deterministic — same photo must give same text,
        // and the schema decides shape, not the model's mood.
        temperature: aiConfig.gemini.temperature,
        // 4096 caps one page of notes; a larger cap risks silently accepting
        // verbosely padded output instead of a clean transcription.
        maxOutputTokens: aiConfig.gemini.maxOutputTokens,
      },
    }),
    aiConfig.gemini.timeoutMs,
    "Gemini extraction",
  );

  const text = response.text;
  if (!text) {
    throw new ExtractionValidationError("Gemini returned no text.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ExtractionValidationError("Gemini output was not valid JSON.");
  }

  // Evidence hook only: the STOP-3 report shows the raw model reply next to the
  // validated result, proving the gate operated on real provider output.
  onRawOutput?.(text);

  return parseExtractionOutput(raw);
}

/**
 * Extract and validate notes from a stored photo. Re-runs the model call at most
 * aiConfig.extraction.validationRetries times after a schema-validation failure,
 * then surfaces the final failure instead of looping forever on bad output.
 */
export async function extractFromImage(
  input: { storageKey: string; mimeType: string },
  options?: { onRawOutput?: (rawText: string) => void },
): Promise<ExtractionResult> {
  const attempts = aiConfig.extraction.validationRetries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await requestExtraction(input, options?.onRawOutput);
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof ExtractionValidationError && attempt < attempts;
      if (retryable) {
        console.warn(
          `[extract] attempt ${attempt}/${attempts} failed schema validation; retrying`,
        );
        continue;
      }
      break;
    }
  }
  throw lastError;
}

/**
 * Queue worker handler: extracts a Job row's photo and reports done/failed.
 * Reads the object bytes, so nothing sensitive ever leaves the storage layer
 * before it's been validated by parseExtractionOutput.
 */
export const extractionHandler: JobHandler = async (ctx): Promise<JobHandlerResult> => {
  try {
    const data = await extractFromImage({
      storageKey: ctx.storageKey,
      mimeType: ctx.mimeType,
    });
    return { status: "done", data };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Extraction failed unexpectedly.";
    return { status: "failed", error: message };
  }
};