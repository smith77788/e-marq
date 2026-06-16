/**
 * Nitro server middleware — HTTP security headers.
 *
 * Nitro auto-discovers files in server/middleware/ and runs them for every
 * request before route handlers. This file adds standard security headers
 * to every HTTP response from the server.
 *
 * References:
 *   https://nitro.build/guide/middleware
 *   https://owasp.org/www-project-secure-headers/
 */
import { defineEventHandler, setResponseHeader } from "h3";

export default defineEventHandler((event) => {
  // Prevent clickjacking
  setResponseHeader(event, "X-Frame-Options", "DENY");

  // Block MIME-type sniffing
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  // Enforce HTTPS for 1 year (including subdomains)
  setResponseHeader(event, "Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Send only origin (no path/query) in the Referer header on cross-origin requests
  setResponseHeader(event, "Referrer-Policy", "strict-origin-when-cross-origin");

  // Disable browser features the app does not use
  setResponseHeader(event, "Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

  // Content Security Policy
  // 'unsafe-inline' is needed for Tailwind's style injection and TanStack Router's inline scripts.
  // Tighten nonces/hashes once the full asset inventory is stable.
  setResponseHeader(event, "Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.liqpay.ua https://secure.wayforpay.com https://api.monobank.ua",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "));
});
