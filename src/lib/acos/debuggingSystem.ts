/**
 * Smart API Debugging — відлагодження API запитів.
 *
 * Функції:
 * 1. Request logging — логування запитів
 * 2. Response logging — логування відповідей
 * 3. Error debugging — відлагодження помилок
 * 4. Performance analysis — аналіз продуктивності
 */

export type DebugInfo = {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  query: Record<string, string>;
  timestamp: string;
};

/**
 * Зібрати debug інформацію про запит.
 */
export function collectDebugInfo(request: Request): DebugInfo {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    requestId: crypto.randomUUID(),
    method: request.method,
    path: url.pathname,
    headers,
    query,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Debug response.
 */
export function debugResponse(
  debugInfo: DebugInfo,
  response: Response,
  duration: number,
): Record<string, unknown> {
  return {
    request: {
      method: debugInfo.method,
      path: debugInfo.path,
      query: debugInfo.query,
    },
    response: {
      status: response.status,
      statusText: response.statusText,
    },
    duration_ms: duration,
    timestamp: debugInfo.timestamp,
  };
}

/**
 * Debug error.
 */
export function debugError(
  error: unknown,
  context?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    error: error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : String(error),
    context,
    timestamp: new Date().toISOString(),
  };
}
