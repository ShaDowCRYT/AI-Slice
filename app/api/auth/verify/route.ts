import { NextRequest, NextResponse } from "next/server";
import { verifySchema } from "@/lib/schemas/auth";
import { verifyEmail } from "@/lib/auth/verify";
import { enforceRateLimit, badRequest } from "../_shared";

// Rate limit: 3 verifications per IP per 15 minutes
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit("verify", 3, 15 * 60 * 1000);
  if (limited) return limited;

  const formData = await request.formData();
  const parsed = verifySchema.safeParse({
    email: formData.get("email") as string,
    code: formData.get("code") as string,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message);
  }

  const result = await verifyEmail(parsed.data);
  if ("error" in result) return badRequest(result.error);

  return NextResponse.json({ success: true });
}