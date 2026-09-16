import { NextRequest, NextResponse } from "next/server";
import { verifySchema } from "@/lib/schemas/auth";
import { verifyResetCode } from "@/lib/auth/reset";
import { enforceRateLimit, badRequest } from "../_shared";

// Rate limit: 5 code checks per IP per 15 minutes (brute-force guard)
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(
    "verify-reset-code",
    5,
    15 * 60 * 1000
  );
  if (limited) return limited;

  const formData = await request.formData();
  const parsed = verifySchema.safeParse({
    email: formData.get("email") as string,
    code: formData.get("code") as string,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message);
  }

  const result = await verifyResetCode(parsed.data);
  if ("error" in result) return badRequest(result.error);

  return NextResponse.json({ success: true });
}