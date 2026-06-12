/**
 * Lightweight in-process per-IP rate limiter and request helpers.
 *
 * Limitation: resets on server restart and does not scale across multiple
 * instances. Acceptable for low-traffic or single-instance deployments; for
 * multi-instance or high-traffic use replace with a Redis-backed counter.
 *
 * Stale entries (window expired) are evicted lazily on each access plus a
 * periodic full sweep every `sweepEveryMs` ms (default 5 min) to bound memory
 * usage even if a single attacker cycles through millions of IPs.
 */

type Bucket = { count: number; reset: number };

export interface RateLimiter {
  /** Returns true if the request is allowed, false if the limit is exceeded. */
  check(key: string): boolean;
}

/** Extract client IP from standard proxy headers (Cloudflare → X-Forwarded-For → X-Real-IP). */
export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function originUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || req.headers.get("x-forwarded-host") || "";
  return `${proto}://${host}`;
}

export function createIpRateLimiter(opts: {
  /** Max requests per window per key. Default 10. */
  limit?: number;
  /** Window length in milliseconds. Default 60_000 (1 min). */
  windowMs?: number;
  /** How often to sweep all stale entries. Default 300_000 (5 min). */
  sweepEveryMs?: number;
}): RateLimiter {
  const limit = opts.limit ?? 10;
  const windowMs = opts.windowMs ?? 60_000;
  const sweepEveryMs = opts.sweepEveryMs ?? 300_000;

  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  function sweep(now: number) {
    for (const [key, b] of buckets) {
      if (b.reset < now) buckets.delete(key);
    }
    lastSweep = now;
  }

  return {
    check(key: string): boolean {
      const now = Date.now();
      if (now - lastSweep > sweepEveryMs) sweep(now);

      const b = buckets.get(key);
      if (!b || b.reset < now) {
        buckets.set(key, { count: 1, reset: now + windowMs });
        return true;
      }
      if (b.count >= limit) return false;
      b.count += 1;
      return true;
    },
  };
}
