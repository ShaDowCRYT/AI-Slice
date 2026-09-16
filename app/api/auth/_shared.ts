// Shared helpers for /api/auth/* route handlers.

import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Applies the per-IP sliding-window limit for this route. Returns a 429
// response with a Retry-After header when blocked, otherwise null.
export async function enforceRateLimit(
  route: string,
  limit: number,
  windowMs: number
): Promise<NextResponse | null> {
  const ip = await getClientIp();
  const rl = checkRateLimit(ip, route, limit, windowMs);
  if (!rl.allowed) {
    const message = `Too many attempts. Try again in ${rl.retryAfterSeconds} seconds.`;
    return NextResponse.json(
      { error: message },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      }
    );
  }
  return null;
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}