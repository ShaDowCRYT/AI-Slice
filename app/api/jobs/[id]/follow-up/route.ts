import { NextRequest, NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai/config";
import {
  followUpActionSchema,
  refineNotes,
} from "@/lib/ai/followup";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { badRequest, enforceRateLimit } from "../../../auth/_shared";

// User-triggered refine step (summarise / rephrase / expand) on an already
// extracted job. Runs synchronously — the result screen awaits it — so it has
// its own, tighter rate-limit bucket than uploads (every call is a paid
// DeepSeek call).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await enforceRateLimit(
    "api-jobs-follow-up",
    aiConfig.rateLimits.followUp.limit,
    aiConfig.rateLimits.followUp.windowMs,
  );
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to refine notes." }, { status: 401 });
  }

  const { id } = await params;
  const job = await prisma.job.findFirst({ where: { id, userId: session.userId } });
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  let actionRaw: unknown;
  try {
    actionRaw = (await request.json()).action;
  } catch {
    return badRequest("Invalid request body.");
  }

  const action = followUpActionSchema.safeParse(actionRaw);
  if (!action.success) {
    return badRequest("Choose one follow-up action: summarise, rephrase, or expand.");
  }

  if (job.status !== "DONE") {
    return badRequest("This job hasn't finished extracting yet.");
  }

  const extractedText = (job.extractedData as { text?: unknown } | null)?.text;
  if (typeof extractedText !== "string" || extractedText.length === 0) {
    return badRequest("This job has no extracted text to refine.");
  }

  // Repeating an already-applied action returns the stored result rather than
  // spending another paid call (a quick double-click shouldn't bill twice).
  if (job.followUpType === action.data && job.followUpResult) {
    return NextResponse.json({
      followUpType: job.followUpType,
      followUpResult: job.followUpResult,
    });
  }

  try {
    const result = await refineNotes({ sourceText: extractedText, action: action.data });
    await prisma.job.update({
      where: { id: job.id },
      data: { followUpType: action.data, followUpResult: result.result },
    });
    return NextResponse.json(
      { followUpType: action.data, followUpResult: result.result },
      { status: 201 },
    );
  } catch (err) {
    // Real detail (validation failure, timeout, provider 429...) is logged for
    // debugging here; the user gets a clean retry message, and the Job row is
    // untouched so a retry stays possible without re-extracting.
    console.error("[follow-up] refine failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "The refinement service couldn't complete that right now. Try again in a moment." },
      { status: 502 },
    );
  }
}