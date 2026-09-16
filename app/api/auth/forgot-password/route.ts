import { NextRequest, NextResponse } from "next/server";
import { forgotPasswordSchema } from "@/lib/schemas/auth";
import { requestPasswordReset } from "@/lib/auth/reset";
import { enforceRateLimit, badRequest } from "../_shared";

// Rate limit: 2 requests per IP per 15 minutes (email has a direct cost)
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(
    "forgot-password",
    2,
    15 * 60 * 1000
  );
  if (limited) return limited;

  const formData = await request.formData();
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email") as string,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message);
  }

  const result = await requestPasswordReset(parsed.data);
  if ("error" in result) return badRequest(result.error);

  return NextResponse.json({ success: true });
}