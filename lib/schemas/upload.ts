// Single Zod schema shared between client-side file validation and the
// server-side check on POST /api/jobs. Client-side validation is UX only —
// the server always re-validates with this same schema, so a bypassed form
// can't smuggle a wrong-type or oversized file through.

import { z } from "zod";

// Images only — handwritten notes come in as photos/scans. HEIC is excluded
// (unsupported by most server-side pipelines and by browsers), which is why
// the <input accept> list and this list are kept in lockstep.
export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

// 10 MB caps a high-res phone photo while rejecting any accidental large
// file; a page of handwritten notes is a fraction of this.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// File extensions used to build the storage key, kept in lockstep with
// ACCEPTED_MIME_TYPES above.
export const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const isUploadFile = (value: unknown): value is File =>
  typeof File !== "undefined" && value instanceof File;

export const uploadSchema = z.object({
  file: z
    .custom<File>(isUploadFile, "No file was selected")
    .refine(
      (f) => (ACCEPTED_MIME_TYPES as readonly string[]).includes(f.type),
      "File type not allowed — use JPEG, PNG, or WebP.",
    )
    .refine((f) => f.size > 0, "File is empty.")
    .refine(
      (f) => f.size <= MAX_UPLOAD_BYTES,
      `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`,
    ),
});

export type UploadInput = z.infer<typeof uploadSchema>;