"use client";

import { useEffect, useState } from "react";
import { verifySchema } from "@/lib/schemas/auth";
import { useApiForm } from "@/lib/use-api-form";
import { useCooldown } from "@/lib/use-cooldown";
import { useRouter } from "next/navigation";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  const verifyForm = useApiForm("/api/auth/verify");
  const resendForm = useApiForm("/api/auth/resend-code");
  const resendCooldown = useCooldown(60);

  async function handleVerify(form: HTMLFormElement) {
    const formData = new FormData(form);
    const parsed = verifySchema.safeParse({
      email: formData.get("email") as string,
      code: formData.get("code") as string,
    });
    if (!parsed.success) {
      verifyForm.setError(parsed.error.issues[0].message);
      return;
    }
    await verifyForm.submit(formData);
  }

  async function handleResend(form: HTMLFormElement) {
    const formData = new FormData(form);
    const ok = await resendForm.submit(formData);
    if (ok) resendCooldown.start();
  }

  useEffect(() => {
    if (verifyForm.success) {
      router.push("/dashboard");
    }
  }, [verifyForm.success, router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
              Verify Email
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the 6-digit code sent to your email address
            </p>
          </div>

          {verifyForm.error && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-error-border bg-error-bg p-4 text-sm text-error"
            >
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{verifyForm.error}</span>
              </div>
            </div>
          )}

          {resendForm.error && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-error-border bg-error-bg p-4 text-sm text-error"
            >
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{resendForm.error}</span>
              </div>
            </div>
          )}

          {resendForm.success && (
            <div className="mb-6 rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success">
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>New code sent! Check your email.</span>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleVerify(e.currentTarget);
            }}
            className="space-y-5"
          >
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-card-foreground"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>

            <div>
              <label
                htmlFor="code"
                className="mb-2 block text-sm font-medium text-card-foreground"
              >
                Verification Code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="••••••"
                className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm tracking-[0.3em] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={verifyForm.pending}
              className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {verifyForm.pending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Verifying...
                </span>
              ) : (
                "Verify"
              )}
            </button>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleResend(e.currentTarget);
            }}
            className="mt-6 text-center"
          >
            <input type="hidden" name="email" value={email} />
            <button
              type="submit"
              disabled={resendForm.pending || resendCooldown.active || !email}
              className="text-sm font-medium text-primary hover:text-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {resendForm.pending
                ? "Sending..."
                : resendCooldown.active
                  ? `Resend in ${resendCooldown.remaining}s`
                  : "Didn't receive a code? Resend"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}