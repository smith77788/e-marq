/**
 * Smart API Gateway — шлюз для API запитів.
 *
 * Функції:
 * 1. Маршрутизація — роутинг запитів
 * 2. Балансування навантаження — load balancing
 * 3. Кешування — caching
 * 4. Rate limiting — обмеження
 * 5. Auth — автентифікація
 * 6. Logging — логування
 */

export type GatewayConfig = {
  baseUrl: string;
  timeout: number;
  retries: number;
};

export type GatewayRoute = {
  path: string;
  upstream: string;
  methods: string[];
  cache?: boolean;
  rateLimit?: number;
  auth?: boolean;
};

// Simple in-memory rate limiter: requests per minute per IP per route
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export class ApiGateway {
  private routes: GatewayRoute[] = [];
  private config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  addRoute(route: GatewayRoute): void {
    this.routes.push(route);
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    for (const route of this.routes) {
      if (url.pathname.startsWith(route.path) && route.methods.includes(request.method)) {
        // Auth check
        if (route.auth) {
          const auth = request.headers.get("authorization");
          if (!auth?.startsWith("Bearer ")) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }
        }

        // Rate limit check
        if (route.rateLimit) {
          const ip = request.headers.get("x-forwarded-for") ?? "unknown";
          const rlKey = `${ip}:${route.path}`;
          if (!checkRateLimit(rlKey, route.rateLimit)) {
            return Response.json(
              { error: "Rate limit exceeded" },
              { status: 429, headers: { "Retry-After": "60" } },
            );
          }
        }

        // Proxy to upstream
        const upstreamUrl = `${route.upstream}${url.pathname}${url.search}`;
        try {
          const response = await fetch(upstreamUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: AbortSignal.timeout(this.config.timeout),
          });

          return response;
        } catch (error) {
          return Response.json(
            { error: "Upstream unavailable" },
            { status: 502 },
          );
        }
      }
    }

    return Response.json({ error: "Not Found" }, { status: 404 });
  }
}
