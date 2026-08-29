/**
 * Per-user rate limiting for /mcp and /api/*. In-memory sliding window —
 * fine for a single Fly VM; the OAuth endpoints have their own limits
 * (@tmcp/auth). Keys are per-user, so one abusive account can't starve
 * others.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true if the request is allowed, false if over the limit. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

/** Sweep expired buckets so the map doesn't grow unbounded. */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
// Don't keep the process alive just for the sweep (Bun.serve already does).
sweep.unref?.();

export const MCP_RATE_LIMIT = { max: 120, windowMs: 60_000 };
export const API_RATE_LIMIT = { max: 240, windowMs: 60_000 };
