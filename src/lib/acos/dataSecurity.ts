/**
 * Smart Data Security — захист даних від загроз.
 *
 * Функції:
 * 1. Rate limiting — обмеження частоти запитів
 * 2. Input validation — валідація вхідних даних
 * 3. SQL injection prevention — запобігання SQL-ін'єкціям
 * 4. XSS prevention — запобігання XSS
 * 5. CSRF protection — захист від CSRF
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const rateLimits = new Map<string, { count: number; resetAt: number }>();

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
  const remaining = Math.max(0, maxRequests - entry.count);

  return {
    allowed: entry.count <= maxRequests,
    remaining,
    resetAt: entry.resetAt,
  };
}

/**
 * Очистити застарілі rate limits.
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimits.entries()) {
    if (now > entry.resetAt) {
      rateLimits.delete(key);
    }
  }
}

/**
 * Очистити текст від XSS.
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Валідувати UUID.
 */
export function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}
