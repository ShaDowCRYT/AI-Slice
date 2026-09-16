import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Lightweight cookie check for /dashboard protection.
// Runs on Edge runtime where Prisma is not available.
// Full session validation happens server-side in the page component.
// An expired or missing session cookie redirects to /signin.

export function proxy(request: NextRequest) {
  const sessionCookie = request.cookies.get("session_id");

  if (!sessionCookie?.value) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
