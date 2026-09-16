"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { ExtractionResult } from "@/lib/schemas/extraction-result";

export interface JobViewData {
  id: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  mimeType: string;
  extractedData: Record<string, unknown> | null;
  followUpType: string | null;
  followUpResult: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

const POLL_INTERVAL_MS = 2000;

export default function JobView({
  job: initial,
  batch,
}: {
  job: JobViewData;
  batch: string[];
}) {
  const [job, setJob] = useState<JobViewData>(initial);

  useEffect(() => {
    if (job.status === "DONE" || job.status === "FAILED") return;

    const poll = async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as JobViewData;
      setJob(data);
    };

    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job.id, job.status]);

  const busy = job.status === "PENDING" || job.status === "PROCESSING";

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      {busy && (
        <div className="rounded-lg border border-border bg-card p-6 text-center" aria-live="assertive">
          <div aria-hidden className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="mt-4 text-lg font-medium">
            {job.status === "PENDING" ? "Queued" : "Extracting notes…"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {job.status === "PENDING"
              ? "Your photo is waiting in the queue to be processed."
              : "Your photo is being processed. This happens in the background — you can leave this page and come back."}
          </p>
        </div>
      )}

      {job.status === "FAILED" && (
        <div className="rounded-lg border border-destructive/50 border-destructive bg-destructive/5 p-6" role="alert">
          <p className="text-lg font-medium text-destructive-foreground">Extraction failed</p>
          <p className="mt-2 text-sm">
            {job.errorMessage ??
              "Something went wrong while processing this photo."}
          </p>
        </div>
      )}

      {job.status === "DONE" && (
        <ResultView job={job} />
      )}

      {batch.length > 1 && (
        <nav className="mt-8" aria-label="Other uploads in this batch">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Uploaded together
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {batch.map((otherId) => (
              <li key={otherId}>
                <Link
                  href={`/jobs/${otherId}?batch=${batch.filter((b) => b !== otherId).join(",")}`}
                  className={`inline-block rounded-md border px-3 py-1.5 text-sm ${
                    otherId === job.id
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border text-muted-foreground hover:border-primary"
                  }`}
                >
                  {otherId === job.id ? "Current" : `Job ${otherId.slice(-4)}`}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  );
}

function ResultView({ job }: { job: JobViewData }) {
  const data = job.extractedData as ExtractionResult | null;
  const text = typeof data?.text === "string" ? data.text : "";
  const title = typeof data?.title === "string" ? data.title : "Untitled notes";
  const keyPoints = Array.isArray(data?.keyPoints) ? data.keyPoints.filter((k) => typeof k === "string") : [];
  const sections = Array.isArray(data?.sections) ? data.sections : [];

  return (
    <article className="rounded-lg border border-border bg-card p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Extracted from {job.mimeType} · job {job.id.slice(-6)}
      </p>

      <div className="mt-4 whitespace-pre-wrap rounded-md border border-border bg-background p-4 text-sm leading-relaxed">
        {text}
      </div>

      {keyPoints.length > 0 && (
        <section className="mt-6" aria-label="Key points">
          <h2 className="text-sm font-semibold">Key points</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      {sections.length > 0 && (
        <section className="mt-6" aria-label="Sections">
          <h2 className="text-sm font-semibold">Sections</h2>
          {sections.map((section, i) => (
            <div key={i} className="mt-3">
              <h3 className="text-sm font-medium">{section.heading}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">
                {section.content}
              </p>
            </div>
          ))}
        </section>
      )}

      <FollowUpSection jobId={job.id} initial={job} />
    </article>
  );
}

function FollowUpSection({ jobId, initial }: { jobId: string; initial: JobViewData }) {
  const [result, setResult] = useState<string | null>(initial.followUpResult);
  const [applied, setApplied] = useState<"summarise" | "rephrase" | "expand" | null>(
    (initial.followUpType as "summarise" | "rephrase" | "expand" | null) ?? null,
  );
  const [pending, setPending] = useState<null | "summarise" | "rephrase" | "expand">(null);
  const [error, setError] = useState<string | null>(null);

  const ACTIONS: Array<{ id: "summarise" | "rephrase" | "expand"; label: string }> = [
    { id: "summarise", label: "Summarise" },
    { id: "rephrase", label: "Rephrase" },
    { id: "expand", label: "Expand" },
  ];

  const refine = async (action: "summarise" | "rephrase" | "expand") => {
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json()) as { followUpResult?: string; followUpType?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? "The refinement failed. Try again.");
        return;
      }
      setResult(body.followUpResult ?? null);
      setApplied((body.followUpType as typeof applied) ?? action);
    } catch {
      setError("The refinement failed. Try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="mt-8 border-t border-border pt-6" aria-labelledby="follow-up-heading">
      <h2 id="follow-up-heading" className="text-sm font-semibold">
        Refine with AI
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        One follow-up on the extracted text. Choosing another action replaces the
        previous result.
      </p>

      {applied && result ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            {applied} result
          </p>
          <div className="mt-2 rounded-md border border-border bg-background p-4 text-sm leading-relaxed">
            {result}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {ACTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => refine(id)}
            disabled={pending !== null}
            aria-busy={pending === id}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending === id
              ? "Working…"
              : applied === id
                ? `${label} (applied)`
                : label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}