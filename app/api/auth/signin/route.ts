import { NextRequest, NextResponse } from "next/server";
import { signinSchema } from "@/lib/schemas/auth";
import { signIn } from "@/lib/auth/signin";
import { enforceRateLimit, badRequest } from "../_shared";

// Rate limit: 5 signins per IP per 15 minutes
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit("signin", 5, 15 * 60 * 1000);
  if (limited) return limited;

  const formData = await request.formData();
  const parsed = signinSchema.safeParse({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message);
  }

  const result = await signIn(parsed.data);
  if ("error" in result) return badRequest(result.error);

  return NextResponse.json({ success: true });
}