import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// Polled by the processing-state screen. Returns the subset of the Job row the
// UI needs — including, honestly, the errorMessage when the job failed.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sign in to view this job." },
      { status: 401 },
    );
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.userId },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    mimeType: job.mimeType,
    extractedData: job.extractedData,
    followUpType: job.followUpType,
    followUpResult: job.followUpResult,
    errorMessage: job.errorMessage,
    attempts: job.attempts,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}