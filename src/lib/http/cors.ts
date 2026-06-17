const ALLOWED_ORIGINS = [
  "https://e-marq.lovable.app",
  "https://marq.app",
  // Add custom domain here when configured
];

function getAllowedOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return ALLOWED_ORIGINS[0];
  // Check exact match
  if (ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  // Check Lovable preview deployments (id-preview--*.lovable.app)
  if (/^https:\/\/[a-z0-9]+-preview--lovable\.app$/i.test(requestOrigin)) return requestOrigin;
  // Default to first allowed origin
  return ALLOWED_ORIGINS[0];
}

export function getCorsHeaders(requestOrigin: string | null = null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(requestOrigin),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
    "Access-Control-Max-Age": "86400",
  };
}

// Legacy export for backward compatibility
export const CORS_HEADERS = getCorsHeaders();

export function withCors(response: Response, request?: Request | null): Response {
  const headers = new Headers(response.headers);
  const origin = request?.headers.get("origin") ?? request?.headers.get("Origin") ?? null;
  const corsHeaders = getCorsHeaders(origin);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
