// Signup service. Plain server-side module (not a server action) — the
// endpoint's rate limiting and parsing live in app/api/auth/signup/route.ts.

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signupSchema } from "@/lib/schemas/auth";
import { sendVerificationEmail } from "@/lib/auth/verify";

export type SignupResult = { success: true } | { error: string };

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function createAccount(data: {
  fullName: string;
  email: string;
  password: string;
}): Promise<SignupResult> {
  const parsed = signupSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { fullName, email, password } = parsed.data;

  const passwordHash = await hashPassword(password);

  try {
    await prisma.user.create({
      data: { fullName, email, passwordHash },
    });
  } catch (e: unknown) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      e.code === "P2002"
    ) {
      // Idempotent: unique constraint violation — account exists, treat as success
    } else {
      return { error: "Something went wrong. Please try again." };
    }
  }

  // Generate and store verification code
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.verificationCode.deleteMany({
        where: { userId: user.id },
      });

      await prisma.verificationCode.create({
        data: { userId: user.id, code, expiresAt },
      });
    }
  } catch {
    // Never let a raw database exception reach the client
    return { error: "Something went wrong. Please try again." };
  }

  // Email delivery is best-effort — the account and code are persisted,
  // so the user can always retry via the resend-code endpoint.  If the
  // SMTP server is unreachable the request should not become a 400.
  try {
    await sendVerificationEmail(email, code);
  } catch {
    console.error(`Signup: verification email to ${email} could not be sent`);
  }

  return { success: true };
}