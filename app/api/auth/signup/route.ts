import { NextRequest, NextResponse } from "next/server";
import { signupSchema } from "@/lib/schemas/auth";
import { createAccount } from "@/lib/auth/signup";
import { enforceRateLimit, badRequest } from "../_shared";

// Rate limit: 5 signups per IP per 15 minutes
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit("signup", 5, 15 * 60 * 1000);
  if (limited) return limited;

  const formData = await request.formData();
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName") as string,
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message);
  }

  const result = await createAccount(parsed.data);
  if ("error" in result) return badRequest(result.error);

  return NextResponse.json({ success: true });
}