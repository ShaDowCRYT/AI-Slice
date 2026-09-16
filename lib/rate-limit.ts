// In-memory rate limiter held in a Map stored on globalThis.
// Keying on globalThis (not bare module scope) survives Next.js dev-mode
// hot reloads under Turbopack, where re-executing a module would otherwise
// re-instantiate the store and silently wipe every bucket.
// No Redis — see DOCUMENTATION.md Section 5 for the tradeoff.

import { headers } from "next/headers";

interface RateLimitEntry {
  timestamps: number[];
}

// Single shared instance across every import and across hot reloads.
const globalForStorage = globalThis as unknown as {
  rateLimitStore?: Map<string, RateLimitEntry>;
};
const store = (globalForStorage.rateLimitStore ??= new Map<
  string,
  RateLimitEntry
>());

/**
 * Resolve the real client IP so each remote address gets its own bucket.
 * Server actions run server-side; the IP arrives via forwarding headers.
 * Falls back to "unknown" when no proxy is present (e.g. direct localhost),
 * where there is genuinely a single client.
 */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  const forwarded = headersList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headersList.get("x-real-ip") ?? "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function checkRateLimit(
  ip: string,
  route: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const key = `${ip}:${route}`;
  const now = Date.now();
  const entry = store.get(key) ?? { timestamps: [] };

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0];
    const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
    store.set(key, entry);
    return { allowed: false, retryAfterSeconds };
  }

  entry.timestamps.push(now);
  store.set(key, entry);
  return { allowed: true };
}
