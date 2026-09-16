// lib/ai/followup.ts — the user-triggered refine step on already-extracted
// notes, via DeepSeek.
//
// DeepSeek has no SDK of its own; the official OpenAI SDK pointed at
// https://api.deepseek.com is the brief-sanctioned "compatible official SDK"
// allowance, not a shortcut. The one written follow-up system prompt lives here.
// Same discipline as extraction: the reply is re-validated against a Zod schema
// in this file before it is stored, with one defined retry on schema failure.

import OpenAI from "openai";
import { z } from "zod";

import { aiConfig } from "./config";
import { withTimeout } from "./extract";

export const FOLLOWUP_ACTIONS = ["summarise", "rephrase", "expand"] as const;
export type FollowUpAction = (typeof FOLLOWUP_ACTIONS)[number];

/** Validates the action the UI submits — the fixed three, nothing else. */
export const followUpActionSchema = z.enum(FOLLOWUP_ACTIONS);

/** The single follow-up payload DeepSeek must produce: the refined text. */
export const followUpResultSchema = z.object({
  result: z.string().min(1).max(20_000),
});
export type FollowUpResult = z.infer<typeof followUpResultSchema>;

export const FOLLOWUP_SYSTEM_PROMPT = [
  "You refine notes that were already extracted from a photo of handwritten text.",
  "You never see the image, you never transcribe: you work only on the extracted text you are given.",
  "Follow the action you are told: summarise (compress to the essential meaning), rephrase (same content, clearer wording), or expand (elaborate with detail consistent with the notes).",
  "Stay faithful to the source — do not invent facts the notes do not support.",
  "Reply with JSON only, in exactly this shape: {\"result\": \"the refined text\"}.",
].join("\n");

/** A DeepSeek reply that failed our schema. */
export class FollowUpValidationError extends Error {}

/** Parse + Zod-validate a DeepSeek JSON reply. Throws FollowUpValidationError. */
export function parseFollowUpResult(raw: unknown): FollowUpResult {
  const parsed = followUpResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FollowUpValidationError("The refinement output failed validation.");
  }
  return parsed.data;
}

const deepSeekClient = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

function buildMessages(sourceText: string, action: FollowUpAction) {
  return [
    { role: "system" as const, content: FOLLOWUP_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: [
        `Action: ${action}`,
        "Notes to refine:",
        '"""',
        sourceText,
        '"""',
      ].join("\n"),
    },
  ];
}

async function requestRefine(
  sourceText: string,
  action: FollowUpAction,
): Promise<FollowUpResult> {
  const response = await withTimeout(
    deepSeekClient.chat.completions.create({
      model: aiConfig.deepseek.model,
      messages: buildMessages(sourceText, action),
      // 0.4: faithful but not wooden — same knob the model config documents.
      temperature: aiConfig.deepseek.temperature,
      // 2048 tokens — a refined result shouldn't exceed the notes' own size.
      max_tokens: aiConfig.deepseek.maxOutputTokens,
      // JSON object mode; the system prompt above carries the literal "JSON"
      // the mode requires, and we still re-validate the reply ourselves.
      response_format: { type: "json_object" },
    }),
    aiConfig.deepseek.timeoutMs,
    "DeepSeek follow-up",
  );

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new FollowUpValidationError("The refinement service returned no text.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FollowUpValidationError("The refinement output was not valid JSON.");
  }

  return parseFollowUpResult(raw);
}

/** Refine notes, retrying once on schema failure via config, else failing cleanly. */
export async function refineNotes(input: {
  sourceText: string;
  action: FollowUpAction;
}): Promise<FollowUpResult> {
  const attempts = aiConfig.deepseek.validationRetries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await requestRefine(input.sourceText, input.action);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof FollowUpValidationError && attempt < attempts;
      if (retryable) {
        console.warn(
          `[followup] attempt ${attempt}/${attempts} failed validation; retrying`,
        );
        continue;
      }
      break;
    }
  }
  throw lastError;
}