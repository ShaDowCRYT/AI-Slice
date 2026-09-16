// Email-verification service. Plain server-side module (not a server action) —
// rate limiting lives in app/api/auth/verify and app/api/auth/resend-code.

import { prisma } from "@/lib/prisma";
import { verifySchema } from "@/lib/schemas/auth";
import { createSession } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email";

export type VerifyResult = { success: true } | { error: string };

export async function sendVerificationEmail(
  email: string,
  code: string
): Promise<void> {
  const previewUrl = await sendEmail(
    email,
    "Your verification code",
    `Your verification code is: ${code}. It expires in 10 minutes.`,
    `<p>Your verification code is: <strong>${code}</strong>. It expires in 10 minutes.</p>`
  );

  if (previewUrl) {
    console.log("Verification email preview:", previewUrl);
  }
}

export async function verifyEmail(data: {
  email: string;
  code: string;
}): Promise<VerifyResult> {
  const parsed = verifySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, code } = parsed.data;

  let user: { id: string; email: string; emailVerified: boolean } | null;
  try {
    user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { error: "Invalid code or email." };
    }

    // Find code in DB, checking expiry in the query itself (security rule)
    const verificationCode = await prisma.verificationCode.findFirst({
      where: {
        userId: user.id,
        code,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      return { error: "Invalid or expired code." };
    }

    // Mark email as verified and delete the used code
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      }),
      prisma.verificationCode.delete({
        where: { id: verificationCode.id },
      }),
    ]);

    // A just-verified user is signed into the dashboard immediately
    await createSession(user.id);

    return { success: true };
  } catch {
    // Never let a raw database exception reach the client
    return { error: "Something went wrong. Please try again." };
  }
}

export async function resendVerificationCode(data: {
  email: string;
}): Promise<VerifyResult> {
  const parsed = verifySchema.pick({ email: true }).safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let user: { id: string; emailVerified: boolean } | null;
  try {
    user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
  } catch {
    // Never let a raw database exception reach the client
    return { error: "Something went wrong. Please try again." };
  }

  if (!user) {
    // Don't leak account existence
    return { success: true };
  }

  if (user.emailVerified) {
    return { success: true };
  }

  // Delete old codes and create a new one
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    await prisma.verificationCode.deleteMany({
      where: { userId: user.id },
    });

    await prisma.verificationCode.create({
      data: { userId: user.id, code, expiresAt },
    });
  } catch {
    return { error: "Something went wrong. Please try again." };
  }

  try {
    await sendVerificationEmail(parsed.data.email, code);
  } catch {
    // Never let an email/network exception reach the client; SMTP can be down.
    return { error: "Email service unavailable. Please try again later." };
  }

  return { success: true };
}