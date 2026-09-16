import { NextRequest, NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai/config";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  buildExtractionJobData,
  JOB_QUEUE_NAME,
  jobQueue,
} from "@/lib/queue/queue";
import { EXT_BY_MIME, uploadSchema } from "@/lib/schemas/upload";
import { deleteFile, uploadFile } from "@/lib/storage/r2";
import { badRequest, enforceRateLimit } from "../auth/_shared";

// Handles one uploaded file: validate → store in R2 → create the Job row
// (PENDING) → enqueue → return immediately. A 2xx here means "job created and
// queued", never "extraction succeeded" — the work happens in the worker.
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(
    "api-jobs-upload",
    aiConfig.rateLimits.uploadTrigger.limit,
    aiConfig.rateLimits.uploadTrigger.windowMs,
  );
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sign in to upload notes." },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const parsed = uploadSchema.safeParse({
    file: formData.get("file"),
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message);
  }

  const { file } = parsed.data;
  const storageKey = await uploadFile(
    {
      data: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      ext: EXT_BY_MIME[file.type],
    },
    session.userId,
  );

  const job = await prisma.job.create({
    data: {
      userId: session.userId,
      status: "PENDING",
      storageKey,
      mimeType: file.type,
    },
  });

  try {
    await jobQueue.add(
      JOB_QUEUE_NAME,
      buildExtractionJobData({
        jobId: job.id,
        userId: job.userId,
        storageKey: job.storageKey,
        mimeType: job.mimeType,
      }),
      { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
    );
  } catch {
    // Redis/queue unreachable: fail clearly rather than accept an upload that
    // will silently never process. Roll back the row and the stored object so
    // nothing dangles (validation-and-structure.md rule).
    await prisma.job.delete({ where: { id: job.id } });
    await deleteFile(storageKey);
    return NextResponse.json(
      { error: "The extraction service is busy right now. Try again shortly." },
      { status: 503 },
    );
  }

  return NextResponse.json({ jobId: job.id }, { status: 201 });
}