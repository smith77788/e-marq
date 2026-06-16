/**
 * HTTP security headers applied to every server response.
 *
 * Applied via the TanStack Start global middleware defined in
 * src/middleware.ts so all routes (API + SSR pages) benefit automatically.
 *
 * References:
 *   https://owasp.org/www-project-secure-headers/
 *   https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers
 */

export const SECURITY_HEADERS = {
  /** Prevent the app from being framed by other sites (clickjacking). */
  "X-Frame-Options": "DENY",

  /** Block browsers from MIME-type sniffing. */
  "X-Content-Type-Options": "nosniff",

  /**
   * Strict content security policy.
   * - default-src 'self': only same-origin resources by default.
   * - script-src / style-src: allow same-origin + inline styles needed by Tailwind.
   * - connect-src: allow Supabase API calls.
   * - img-src: allow same-origin + data URIs (avatars) + external CDNs if needed.
   * Tighten further once the full asset inventory is known.
   */
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.liqpay.ua https://secure.wayforpay.com https://api.monobank.ua",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),

  /** Only send the origin (no path/query) in the Referer header when crossing origins. */
  "Referrer-Policy": "strict-origin-when-cross-origin",

  /** Enforce HTTPS for 1 year, include subdomains. */
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",

  /** Disable browser features we don't need. */
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
} as const;

/**
 * Applies security headers to an existing Response.
 * Existing headers are preserved; security headers are added only if absent.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
