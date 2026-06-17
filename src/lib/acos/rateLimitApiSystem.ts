/**
 * Smart API Rate Limit — обмеження частоти API запитів.
 *
 * Стратегії:
 * 1. Per-IP — за IP адресою
 * 2. Per-user — за користувачем
 * 3. Per-endpoint — за ендпоінтом
 * 4. Global — глобальне обмеження
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimits = new Map<string, RateLimitEntry>();

/**
 * Перевірити rate limit.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimits.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
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
 * Rate limit за IP.
 */
export function ipRateLimit(
  ip: string,
  maxRequests: number = 100,
  windowMs: number = 60_000,
): { allowed: boolean; remaining: number; resetAt: number } {
  return checkRateLimit(`ip:${ip}`, maxRequests, windowMs);
}

/**
 * Rate limit за користувачем.
 */
export function userRateLimit(
  userId: string,
  maxRequests: number = 1000,
  windowMs: number = 60_000,
): { allowed: boolean; remaining: number; resetAt: number } {
  return checkRateLimit(`user:${userId}`, maxRequests, windowMs);
}

/**
 * Rate limit за ендпоінтом.
 */
export function endpointRateLimit(
  endpoint: string,
  maxRequests: number = 100,
  windowMs: number = 60_000,
): { allowed: boolean; remaining: number; resetAt: number } {
  return checkRateLimit(`endpoint:${endpoint}`, maxRequests, windowMs);
}

/**
 * Очистити застарілі записи.
 */
export function cleanupRateLimits(): number {
  const now = Date.now();
  let count = 0;

  for (const [key, entry] of rateLimits.entries()) {
    if (now > entry.resetAt) {
      rateLimits.delete(key);
      count++;
    }
  }

  return count;
}
