import { NextRequest, NextResponse } from "next/server";
import { verifySchema } from "@/lib/schemas/auth";
import { resendVerificationCode } from "@/lib/auth/verify";
import { enforceRateLimit, badRequest } from "../_shared";

// Rate limit: 3 resends per IP per 5 minutes (tightest limit — direct email cost)
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(
    "resend-code",
    3,
    5 * 60 * 1000
  );
  if (limited) return limited;

  const formData = await request.formData();
  const parsed = verifySchema.pick({ email: true }).safeParse({
    email: formData.get("email") as string,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message);
  }

  const result = await resendVerificationCode(parsed.data);
  if ("error" in result) return badRequest(result.error);

  return NextResponse.json({ success: true });
}