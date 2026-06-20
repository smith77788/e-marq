/**
 * Smart API Security — безпека API ендпоінтів.
 *
 * Захист:
 * 1. Rate limiting — обмеження частоти
 * 2. IP blocking — блокування IP
 * 3. Request validation — валідація запитів
 * 4. CORS —跨域 запити
 * 5. CSRF — захист від CSRF
 */

const blockedIPs = new Set<string>();
const requestCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * Перевірити чи IP заблоковано.
 */
export function isIPBlocked(ip: string): boolean {
  return blockedIPs.has(ip);
}

/**
 * Заблокувати IP.
 */
export function blockIP(ip: string): void {
  blockedIPs.add(ip);
}

/**
 * Розблокувати IP.
 */
export function unblockIP(ip: string): void {
  blockedIPs.delete(ip);
}

/**
 * Rate limit для IP.
 */
export function ipRateLimit(
  ip: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  entry.count++;
  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
  };
}

/**
 * Валідувати Content-Type.
 */
export function validateContentType(
  request: Request,
  expected: string,
): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes(expected);
}

/**
 * Перевірити CORS origin.
 */
export function validateOrigin(
  request: Request,
  allowedOrigins: string[],
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Same-origin requests don't have Origin
  return allowedOrigins.some((o) => origin.startsWith(o));
}

/**
 * Генерувати CSRF token.
 */
export function generateCsrfToken(): string {
  return crypto.randomUUID();
}
