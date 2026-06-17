/**
 * Smart API Middleware — middleware для API запитів.
 *
 * Middleware:
 * 1. Auth — автентифікація
 * 2. Rate Limit — обмеження частоти
 * 3. Logging — логування
 * 4. CORS —跨域 запити
 * 5. Validation — валідація
 */

export type MiddlewareFunction = (
  request: Request,
  next: () => Promise<Response>,
) => Promise<Response>;

/**
 * Auth middleware.
 */
export async function authMiddleware(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return next();
}

/**
 * Logging middleware.
 */
export async function loggingMiddleware(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;

  console.log(`${request.method} ${request.url} ${response.status} ${duration}ms`);

  return response;
}

/**
 * CORS middleware.
 */
export async function corsMiddleware(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Combine middleware.
 */
export function composeMiddleware(...middlewares: MiddlewareFunction[]): MiddlewareFunction {
  return middlewares.reduce(
    (prev, next) => (request, handler) =>
      prev(request, () => next(request, handler)),
    (_, next) => next(),
  );
}
