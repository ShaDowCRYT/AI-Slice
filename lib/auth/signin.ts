// Sign-in service. Plain server-side module (not a server action) — rate
// limiting lives in app/api/auth/signin/route.ts.

import { prisma } from "@/lib/prisma";
import { comparePassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { signinSchema } from "@/lib/schemas/auth";

export type SigninResult = { success: true } | { error: string };

export async function signIn(data: {
  email: string;
  password: string;
}): Promise<SigninResult> {
  const parsed = signinSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, password } = parsed.data;

  let user: {
    id: string;
    email: string;
    passwordHash: string;
    emailVerified: boolean;
  } | null;
  try {
    user = await prisma.user.findUnique({ where: { email } });
  } catch {
    // Never let a raw database exception reach the client
    return { error: "Something went wrong. Please try again." };
  }

  // Same error message for "email not found" and "wrong password" — never leak which emails have accounts
  const invalidMsg = "Invalid email or password.";

  if (!user) {
    // Run a dummy compare to keep timing roughly consistent regardless of whether the user exists
    const DUMMY_HASH =
      "$2b$12$FDJ2LsvWgjpMxCxr8FkmT.4zPOUYpbODZ0JUWG3e3qWrxpNFFSode";
    await comparePassword(password, DUMMY_HASH);
    return { error: invalidMsg };
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    return { error: invalidMsg };
  }

  if (!user.emailVerified) {
    return { error: "Please verify your email before signing in." };
  }

  try {
    await createSession(user.id);
  } catch {
    return { error: "Something went wrong. Please try again." };
  }

  return { success: true };
}