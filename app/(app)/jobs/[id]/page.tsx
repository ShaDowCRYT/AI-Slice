import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import JobView from "./job-view";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/signin");

  const job = await prisma.job.findFirst({
    where: { id, userId: session.userId },
  });
  if (!job) redirect("/upload");

  const batch = (await searchParams).batch?.split(",").filter(Boolean) ?? [];

  return (
    <JobView
      job={{
        id: job.id,
        status: job.status,
        mimeType: job.mimeType,
        extractedData: job.extractedData as Record<string, unknown> | null,
        followUpType: job.followUpType,
        followUpResult: job.followUpResult,
        errorMessage: job.errorMessage,
        attempts: job.attempts,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      }}
      batch={[id, ...batch]}
    />
  );
}