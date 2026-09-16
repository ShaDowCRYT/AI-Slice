// Phase-3 evidence: the app-side validation gate. Whatever Gemini or DeepSeek
// return is re-validated through the SAME Zod schema that shaped the request —
// this script proves that gate actually rejects malformed provider output,
// independently of anything the providers guarantee.
//
//   node --env-file=.env --import tsx scripts/check-validation.ts
//
// Exit code 0 = gate behaves (accepts valid, rejects malformed); 1 = not.

import {
  ExtractionValidationError,
  parseExtractionOutput,
} from "../lib/ai/extract";
import {
  FollowUpValidationError,
  parseFollowUpResult,
} from "../lib/ai/followup";

function check(name: string, fn: () => void): boolean {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (err) {
    console.log(`FAIL ${name} — ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

let allGood = true;

// Valid extraction output: title defaulted, text kept, optional lists kept.
allGood =
  check("extraction accepts well-formed output", () => {
    const out = parseExtractionOutput({
      title: "Linear equations",
      text: "2x + 3 = 7",
      sections: [{ heading: "Solving", content: "subtract 3, divide by 2" }],
      keyPoints: ["x = 2"],
    });
    if (out.text !== "2x + 3 = 7") throw new Error("text mismatch");
  }) && allGood;

// The "harmless extra keys are stripped, not fatal" intent from the schema:
// a non-strict schema must accept a stray key the model added.
allGood =
  check("extraction strips, accepts harmless extra keys", () => {
    const out = parseExtractionOutput({
      title: "Notes",
      text: "some notes",
      confidence: 0.9, // not in the schema — must be stripped silently
    });
    if ("confidence" in out) throw new Error("extra key survived");
  }) && allGood;

// Malformed outputs the provider could plausibly return must ALL be refused.
const malformedExtraction = [
  "not json at all",
  { text: "" }, // empty text — min(1) violated
  { text: 42 }, // wrong type
  { text: "ok", sections: "not-an-array" }, // wrong section shape
  { title: 123, text: "ok" }, // title must be string
];
for (const [i, bad] of malformedExtraction.entries()) {
  allGood =
    check(`extraction rejects malformed output #${i + 1}`, () => {
      try {
        parseExtractionOutput(bad); // must throw
        throw new Error("gate let it through");
      } catch (err) {
        if (err instanceof ExtractionValidationError) return;
        throw err;
      }
    }) && allGood;
}

// The follow-up gate uses the same discipline for DeepSeek replies.
allGood =
  check("follow-up gate accepts well-formed result", () => {
    const parsed = parseFollowUpResult({ result: "refined text" });
    if (parsed.result !== "refined text") throw new Error("mismatch");
  }) && allGood;

const malformedFollowUp = [
  { result: "" }, // empty result — min(1) violated
  { result: 42 }, // wrong type
  { result: "a".repeat(20_001) }, // over the 20k cap
  { result: null },
];
for (const [i, bad] of malformedFollowUp.entries()) {
  allGood =
    check(`follow-up gate rejects malformed result #${i + 1}`, () => {
      try {
        parseFollowUpResult(bad); // must throw
        throw new Error("gate let it through");
      } catch (err) {
        if (err instanceof FollowUpValidationError) return;
        throw err;
      }
    }) && allGood;
}

console.log(allGood ? "\nRESULT: PASS — validation gate holds." : "\nRESULT: FAIL");
process.exit(allGood ? 0 : 1);