/**
 * Smart Rate Limit System — централізована система обмеження частоти.
 *
 * Стратегії:
 * 1. Fixed Window — фіксоване вікно
 * 2. Sliding Window — ковзне вікно
 * 3. Token Bucket — відро токенів
 * 4. Leaky Bucket — відро з витоком
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
  tokens?: number;
  lastRefill?: number;
};

const store = new Map<string, RateLimitEntry>();

/**
 * Fixed Window Rate Limiter.
 */
export function fixedWindowRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count++;
  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Token Bucket Rate Limiter.
 */
export function tokenBucketRateLimit(
  key: string,
  maxTokens: number,
  refillRate: number, // tokens per second
): { allowed: boolean; tokens: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) {
    store.set(key, { count: 0, resetAt: 0, tokens: maxTokens - 1, lastRefill: now });
    return { allowed: true, tokens: maxTokens - 1 };
  }

  // Refill tokens
  const elapsed = (now - (entry.lastRefill ?? now)) / 1000;
  const refill = Math.floor(elapsed * refillRate);
  entry.tokens = Math.min(maxTokens, (entry.tokens ?? maxTokens) + refill);
  entry.lastRefill = now;

  if (entry.tokens > 0) {
    entry.tokens--;
    return { allowed: true, tokens: entry.tokens };
  }

  return { allowed: false, tokens: 0 };
}

/**
 * Очистити застарілі записи.
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt + 60_000) {
      store.delete(key);
    }
  }
}
