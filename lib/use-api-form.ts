"use client";

import { useState } from "react";

type ApiErrorResponse = { error?: string };

// Thin client-side wrapper around a POST-only form endpoint.
// Parse the response body, surface the server error message (including the
// 429 "Too many attempts..." body sent with Retry-After by the route), and
// track pending/success for the submit button and redirects.
export function useApiForm(url: string) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData): Promise<boolean> {
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(url, { method: "POST", body: formData });
      const data = (await res.json().catch(() => null)) as
        | ApiErrorResponse
        | null;
      if (!res.ok || data?.error) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        return false;
      }
      setSuccess(true);
      return true;
    } catch {
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  return { error, setError, success, pending, submit };
}