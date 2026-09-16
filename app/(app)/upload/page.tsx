"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACCEPTED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  uploadSchema,
} from "@/lib/schemas/upload";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";

    const invalid: string[] = [];
    const valid: File[] = [];
    for (const file of picked) {
      const parsed = uploadSchema.safeParse({ file });
      if (!parsed.success) {
        invalid.push(`${file.name}: ${parsed.error.issues[0].message}`);
      } else {
        valid.push(file);
      }
    }
    setErrors(invalid);
    setFiles(valid);
  }

  async function submit() {
    if (files.length === 0) return;
    setBusy(true);
    setErrors([]);

    const jobIds: string[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch("/api/jobs", { method: "POST", body: formData });
        const data = (await res.json().catch(() => null)) as {
          jobId?: string;
          error?: string;
        } | null;
        if (res.ok && data?.jobId) {
          jobIds.push(data.jobId);
        } else {
          setErrors((prev) => [...prev, `${file.name}: ${data?.error ?? "Upload failed."}`]);
        }
      } catch {
        setErrors((prev) => [...prev, `${file.name}: Network error — please try again.`]);
      }
    }
    setBusy(false);

    if (jobIds.length > 0) {
      const batch = jobIds.slice(1).join(",");
      router.push(`/jobs/${jobIds[0]}${batch ? `?batch=${batch}` : ""}`);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold">Extract handwritten notes</h1>
      <p className="mt-1 text-sm text-foreground/60">
        Upload one or more photos of handwritten notes. They are processed in the
        background, and you will be taken to the result when extraction finishes.
      </p>

      <div className="mt-6 rounded-lg border border-border bg-card p-6">
        <label
          htmlFor="notes-files"
          className="block text-sm font-medium text-card-foreground"
        >
          Notes photos
        </label>
        <input
          id="notes-files"
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_MIME_TYPES.join(",")}
          onChange={onPick}
          className="mt-2 block w-full cursor-pointer rounded-md border border-input bg-background text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Accepted: JPEG, PNG, WebP. Max {MAX_UPLOAD_BYTES / (1024 * 1024)} MB per
          file. {files.length > 0 && `${files.length} file${files.length === 1 ? "" : "s"} selected.`}
        </p>

        {errors.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-destructive" aria-live="polite">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={files.length === 0 || busy}
          className="mt-5 w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Uploading…" : files.length === 0 ? "Select a file to start" : `Extract ${files.length} file${files.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </main>
  );
}