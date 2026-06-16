/**
 * TanStack Start global server-function middleware.
 *
 * `createMiddleware({ type: "function" })` intercepts **serverFn** calls
 * (RPCs initiated from the browser via @tanstack/react-start). It does NOT
 * wrap HTTP route handlers (`server: { handlers: { POST: ... } }`).
 *
 * Security headers for HTTP responses are applied via the `withSecurityHeaders`
 * helper exported from `@/lib/http/securityHeaders`. Call it in any route
 * handler that needs them:
 *
 *   import { withSecurityHeaders } from "@/lib/http/securityHeaders";
 *   return withSecurityHeaders(new Response("ok", { status: 200 }));
 *
 * For a true edge-level header injection (all routes automatically), add a
 * Cloudflare Transform Rule or a Worker middleware that calls
 * `withSecurityHeaders` on every outbound Response.
 */
export {};
