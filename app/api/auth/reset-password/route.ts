import { NextRequest, NextResponse } from "next/server";
import { resetPasswordSchema } from "@/lib/schemas/auth";
import { resetPassword } from "@/lib/auth/reset";
import { enforceRateLimit, badRequest } from "../_shared";

// Rate limit: 5 attempts per IP per 15 minutes
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(
    "reset-password",
    5,
    15 * 60 * 1000
  );
  if (limited) return limited;

  const formData = await request.formData();
  const parsed = resetPasswordSchema.safeParse({
    email: formData.get("email") as string,
    code: formData.get("code") as string,
    password: formData.get("password") as string,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message);
  }

  const result = await resetPassword(parsed.data);
  if ("error" in result) return badRequest(result.error);

  return NextResponse.json({ success: true });
}