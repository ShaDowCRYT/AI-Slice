"use client";

import { useState } from "react";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  verifySchema,
} from "@/lib/schemas/auth";
import { useApiForm } from "@/lib/use-api-form";
import { useCooldown } from "@/lib/use-cooldown";
import Link from "next/link";

type Step = "email" | "code" | "password";

const stepHeadings: Record<Step, { title: string; sub: string }> = {
  email: {
    title: "Forgot Password",
    sub: "Enter your email and we'll send you a reset code",
  },
  code: {
    title: "Check your email",
    sub: "We sent a 6-digit code",
  },
  password: {
    title: "Reset Password",
    sub: "Choose a new password for your account",
  },
};

export function ResetPasswordFlow() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const forgotForm = useApiForm("/api/auth/forgot-password");
  const verifyCodeForm = useApiForm("/api/auth/verify-reset-code");
  const resetForm = useApiForm("/api/auth/reset-password");
  const sendCodeCooldown = useCooldown(60);

  const current = stepHeadings[step];

  async function handleRequestCode(form: HTMLFormElement) {
    const formData = new FormData(form);
    const raw = {
      email: formData.get("email") as string,
    };
    const parsed = forgotPasswordSchema.safeParse(raw);
    if (!parsed.success) {
      forgotForm.setError(parsed.error.issues[0].message);
      return;
    }
    const ok = await forgotForm.submit(formData);
    if (ok) {
      setEmail(raw.email);
      setStep("code");
      sendCodeCooldown.start();
    }
  }

  async function handleVerifyCode(form: HTMLFormElement) {
    const formData = new FormData(form);
    const raw = {
      email: formData.get("email") as string,
      code: formData.get("code") as string,
    };
    const parsed = verifySchema.safeParse(raw);
    if (!parsed.success) {
      verifyCodeForm.setError(parsed.error.issues[0].message);
      return;
    }
    const ok = await verifyCodeForm.submit(formData);
    if (ok) {
      setCode(raw.code);
      setStep("password");
    }
  }

  async function handleReset(form: HTMLFormElement) {
    const formData = new FormData(form);
    formData.set("email", email);
    formData.set("code", code);
    const parsed = resetPasswordSchema.safeParse({
      email: formData.get("email") as string,
      code: formData.get("code") as string,
      password: formData.get("password") as string,
    });
    if (!parsed.success) {
      resetForm.setError(parsed.error.issues[0].message);
      return;
    }
    await resetForm.submit(formData);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
              {current.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {current.sub}
              {step === "code" && <span> to {email}</span>}
            </p>
          </div>

          {resetForm.success ? (
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
                <span>
                  Password reset!{" "}
                  <Link
                    href="/signin"
                    className="font-medium underline underline-offset-2 hover:text-success/80"
                  >
                    Sign in
                  </Link>
                </span>
              </div>
            </div>
          ) : (
            <>
              {step === "email" && forgotForm.error && (
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
                    <span>{forgotForm.error}</span>
                  </div>
                </div>
              )}
              {step === "code" && verifyCodeForm.error && (
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
                    <span>{verifyCodeForm.error}</span>
                  </div>
                </div>
              )}
              {step === "password" && resetForm.error && (
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
                    <span>{resetForm.error}</span>
                  </div>
                </div>
              )}

              {step === "email" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleRequestCode(e.currentTarget);
                  }}
                  className="space-y-5"
                >
                  <div>
                    <label
                      htmlFor="reset-email"
                      className="mb-2 block text-sm font-medium text-card-foreground"
                    >
                      Email
                    </label>
                    <input
                      id="reset-email"
                      name="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={forgotForm.pending || sendCodeCooldown.active}
                    className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {forgotForm.pending ? (
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
                        Sending code...
                      </span>
                    ) : sendCodeCooldown.active ? (
                      `Resend in ${sendCodeCooldown.remaining}s`
                    ) : (
                      "Send Reset Code"
                    )}
                  </button>
                </form>
              )}

              {step === "code" && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleVerifyCode(e.currentTarget);
                    }}
                    className="space-y-5"
                  >
                    <input type="hidden" name="email" value={email} />
                    <div>
                      <label
                        htmlFor="reset-code"
                        className="mb-2 block text-sm font-medium text-card-foreground"
                      >
                        Verification Code
                      </label>
                      <input
                        id="reset-code"
                        name="code"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        placeholder="••••••"
                        className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm tracking-[0.3em] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                      />
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Enter the 6-digit code from your email
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={verifyCodeForm.pending}
                      className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {verifyCodeForm.pending ? (
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
                        "Continue"
                      )}
                    </button>
                  </form>

                  <div className="mt-6 text-center">
                    <button
                      type="button"
                      onClick={() => setStep("email")}
                      disabled={sendCodeCooldown.active}
                      className="text-sm font-medium text-primary hover:text-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {sendCodeCooldown.active
                        ? `Resend available in ${sendCodeCooldown.remaining}s`
                        : "Didn't receive a code? Resend"}
                    </button>
                  </div>
                </>
              )}

              {step === "password" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleReset(e.currentTarget);
                  }}
                  className="space-y-5"
                >
                  <div>
                    <label
                      htmlFor="reset-password"
                      className="mb-2 block text-sm font-medium text-card-foreground"
                    >
                      New Password
                    </label>
                    <input
                      id="reset-password"
                      name="password"
                      type="password"
                      required
                      minLength={8}
                      placeholder="At least 8 characters"
                      className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Must be at least 8 characters
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={resetForm.pending}
                    className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {resetForm.pending ? (
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
                        Resetting...
                      </span>
                    ) : (
                      "Reset Password"
                    )}
                  </button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        verifyCodeForm.setError(null);
                        setStep("code");
                      }}
                      className="text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                    >
                      Back to code entry
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              <Link
                href="/signin"
                className="font-medium text-primary hover:text-primary-hover transition-colors"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}