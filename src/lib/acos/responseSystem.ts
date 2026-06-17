/**
 * Smart API Response — стандартизовані API відповіді.
 *
 * Формати:
 * 1. Success — успішна відповідь
 * 2. Error — помилка
 * 3. Paginated — з пагінацією
 * 4. Streamed — стрімінг
 */

export type ApiResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
};

/**
 * Успішна відповідь.
 */
export function successResponse<T>(data: T, meta?: Record<string, unknown>): Response {
  return Response.json({
    ok: true,
    data,
    meta,
  } as ApiResponse<T>);
}

/**
 * Відповідь з помилкою.
 */
export function errorResponse(
  code: string,
  message: string,
  status: number = 400,
  details?: unknown,
): Response {
  return Response.json(
    {
      ok: false,
      error: { code, message, details },
    } as ApiResponse,
    { status },
  );
}

/**
 * Відповідь з пагінацією.
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): Response {
  return Response.json({
    ok: true,
    data,
    meta: {
      page,
      limit,
      total,
      hasMore: page * limit < total,
    },
  } as ApiResponse<T[]>);
}

/**
 * CORS відповідь.
 */
export function corsResponse(response: Response, origin: string = "*"): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
