// STOP-3 evidence: REAL (unmocked) provider calls, end to end.
//   1. One real Gemini extraction on a generated note card — prints the raw
//      model reply next to the app-side validated result.
//   2. One deliberately-broken case: a pure-noise "photo", which is a real
//      provider call the app's validation gate is expected to reject.
//   3. One real DeepSeek follow-up (summarise) on the validated text.
//
//   node --env-file=.env --import tsx scripts/verify-providers.ts
//
// Requires real GEMINI_API_KEY and DEEPSEEK_API_KEY in .env.

import {
  extractionHandler,
  extractFromImage,
  ILLEGIBLE_ONLY_MESSAGE,
} from "../lib/ai/extract";
import { refineNotes } from "../lib/ai/followup";
import { extractionResultSchema } from "../lib/schemas/extraction-result";
import { storageBackend, uploadFile } from "../lib/storage/r2";
import { renderNoiseImage, renderNotesImage } from "./synthetic-notes-image";

async function main() {
  const mime = "image/png";

  // ---- 1. Real Gemini extraction -----------------------------------
  const notesKey = await uploadFile(
    { data: renderNotesImage(), mimeType: mime, ext: "png" },
    "verify-providers",
  );
  const rawOutputs: string[] = [];
  console.log("=== 1. GEMINI EXTRACTION (real key) ===");
  console.log("storageKey:", notesKey, "| backend:", storageBackend());
  const validated = await extractFromImage(
    { storageKey: notesKey, mimeType: mime },
    { onRawOutput: (t) => rawOutputs.push(t) },
  );
  console.log("--- RAW model reply ---");
  for (const raw of rawOutputs) console.log(raw);
  console.log("--- VALIDATED (after parseExtractionOutput) ---");
  console.log(JSON.stringify(validated, null, 2));
  const reapplied = extractionResultSchema.safeParse(JSON.parse(rawOutputs[rawOutputs.length - 1]));
  console.log("--- raw re-parsed against schema ---");
  console.log(reapplied.success ? "PASS — raw output satisfies the locked schema" : "FAIL — raw output rejected");

  // ---- 2. Deliberately-broken input against the real provider ----------
  const brokenKey = await uploadFile(
    { data: renderNoiseImage(), mimeType: mime, ext: "png" },
    "verify-providers",
  );
  console.log("\n=== 2. BROKEN CASE (pure-noise photo, real Gemini call) ===");
  try {
    const noiseRaw: string[] = [];
    const rawValidated = await extractFromImage(
      { storageKey: brokenKey, mimeType: mime },
      { onRawOutput: (t) => noiseRaw.push(t) },
    );
    console.log("Gemini still returns schema-valid text for pure noise:");
    console.log(JSON.stringify({ raw: noiseRaw[noiseRaw.length - 1], validated: rawValidated }));
    // The policy kicks in at the handler: real content after stripping the
    // markers? None → FAILED, even though the schema-validated output passed.
    const handled = await extractionHandler({
      jobId: "broken-demo",
      userId: "verify-providers",
      storageKey: brokenKey,
      mimeType: mime,
    });
    console.log(
      handled.status === "failed" && handled.error === ILLEGIBLE_ONLY_MESSAGE
        ? `Handler decision: FAILED with "${ILLEGIBLE_ONLY_MESSAGE}"`
        : `Handler decision (unexpected): ${JSON.stringify(handled)}`,
    );
  } catch (err) {
    console.log("Rejected earlier than expected:", err instanceof Error ? err.message : String(err));
  }

  // ---- 3. Real DeepSeek follow-up on the validated extraction ----------
  console.log("\n=== 3. DEEPSEEK FOLLOW-UP (summarise, real key) ===");
  const followUp = await refineNotes({ sourceText: validated.text, action: "summarise" });
  console.log(followUp.result);
}

main().catch((err) => {
  console.error("[verify-providers] failed:", err);
  process.exit(1);
});