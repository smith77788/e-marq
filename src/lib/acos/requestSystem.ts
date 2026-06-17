/**
 * Smart API Request — обробка API запитів.
 *
 * Функції:
 * 1. Parse body — парсинг тіла
 * 2. Validate input — валідація вхідних даних
 * 3. Extract params — вилучення параметрів
 * 4. Rate limit check — перевірка обмежень
 */

/**
 * Парсити JSON body.
 */
export async function parseBody<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return request.json() as Promise<T>;
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const result: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      result[key] = value;
    });
    return result as T;
  }

  throw new Error(`Unsupported content type: ${contentType}`);
}

/**
 * Вилучити query params.
 */
export function extractQueryParams(
  request: Request,
  defaults: Record<string, unknown> = {},
): Record<string, string> {
  const url = new URL(request.url);
  const params: Record<string, string> = { ...defaults as Record<string, string> };

  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return params;
}

/**
 * Вилучити path params.
 */
export function extractPathParams(
  pattern: string,
  pathname: string,
): Record<string, string> {
  const params: Record<string, string> = {};
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i] ?? "";
    }
  }

  return params;
}

/**
 * Вилучити client IP.
 */
export function extractClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Вилучити User-Agent.
 */
export function extractUserAgent(request: Request): string {
  return request.headers.get("user-agent") ?? "unknown";
}
