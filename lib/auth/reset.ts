// Password-reset service. Plain server-side module (not a server action) —
// rate limiting lives in app/api/auth/forgot-password and app/api/auth/reset-password.

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  verifySchema,
} from "@/lib/schemas/auth";
import { sendEmail } from "@/lib/email";
import { randomBytes } from "crypto";

export type ResetResult = { success: true } | { error: string };

// Reset codes are derived from crypto.randomBytes(32) via rejection sampling,
// so the 6-digit distribution is uniform (no modulo bias). Chosen over
// Math.random() — it is not cryptographically secure, and this code stands in
// for what used to be a 32-byte one-time token. Codes are stored in the
// existing password_reset_tokens.token column (String @unique), so no schema
// migration is required.
function generateResetCode(): string {
  const RANGE = 900000; // [100000, 1000000)
  const MIN = 100000;
  const LIMIT = Math.floor(0x100000000 / RANGE) * RANGE;

  while (true) {
    const buffer = randomBytes(32);
    for (let offset = 0; offset < buffer.length; offset += 4) {
      const value = buffer.readUInt32BE(offset);
      if (value < LIMIT) {
        return String((value % RANGE) + MIN);
      }
    }
    // Exhausting 32 random bytes of rejection sampling is effectively
    // impossible; loop to draw fresh entropy rather than bias the range.
  }
}

export async function sendResetEmail(
  email: string,
  code: string
): Promise<void> {
  const previewUrl = await sendEmail(
    email,
    "Reset your password",
    `Your password reset code is: ${code}. It expires in 15 minutes.`,
    `<p>Your password reset code is: <strong>${code}</strong>. It expires in 15 minutes.</p>`
  );

  if (previewUrl) {
    console.log("Reset email preview:", previewUrl);
  }
}

export async function requestPasswordReset(data: {
  email: string;
}): Promise<ResetResult> {
  const parsed = forgotPasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let user: { id: string } | null;
  try {
    user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
  } catch {
    // Never let a raw database exception reach the client
    return { error: "Something went wrong. Please try again." };
  }

  // Always return success even if the user doesn't exist — don't leak which emails have accounts
  if (!user) {
    return { success: true };
  }

  // Invalidate any existing unused codes
  const code = generateResetCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  try {
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, used: false },
    });

    await prisma.passwordResetToken.create({
      data: { userId: user.id, token: code, expiresAt },
    });
  } catch {
    return { error: "Something went wrong. Please try again." };
  }

  try {
    await sendResetEmail(parsed.data.email, code);
  } catch {
    // Never let an email/network exception reach the client; SMTP can be down.
    return { error: "Email service unavailable. Please try again later." };
  }

  return { success: true };
}

export async function verifyResetCode(data: {
  email: string;
  code: string;
}): Promise<ResetResult> {
  const parsed = verifySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, code } = parsed.data;

  let resetRecord: { id: string; userId: string } | null;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { error: "Invalid or expired reset code." };
    }

    // Single-use and time-limited: check expiry and used flag in the query itself.
    // Invalid and expired codes fail identically — no leaking which reason caused it.
    resetRecord = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        token: code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true },
    });
  } catch {
    return { error: "Something went wrong. Please try again." };
  }

  if (!resetRecord) {
    return { error: "Invalid or expired reset code." };
  }

  return { success: true };
}

export async function resetPassword(data: {
  email: string;
  code: string;
  password: string;
}): Promise<ResetResult> {
  const parsed = resetPasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, code, password } = parsed.data;

  // Single-use and time-limited: check expiry and used flag in the query itself.
  // Invalid and expired codes fail identically — no leaking which reason caused it.
  let resetRecord: { id: string; userId: string } | null;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { error: "Invalid or expired reset code." };
    }

    resetRecord = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        token: code,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });
  } catch {
    return { error: "Something went wrong. Please try again." };
  }

  if (!resetRecord) {
    return { error: "Invalid or expired reset code." };
  }

  const passwordHash = await hashPassword(password);

  try {
    await prisma.$transaction([
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { used: true },
      }),
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      }),
    ]);
  } catch {
    return { error: "Something went wrong. Please try again." };
  }

  return { success: true };
}