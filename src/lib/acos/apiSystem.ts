/**
 * Smart API System — централізована система API.
 *
 * Ендпоінти:
 * 1. /api/analytics/smart — повна аналітика
 * 2. /api/analytics/dashboard — дашборд
 * 3. /api/analytics/export — експорт
 * 4. /api/ai/ask — AI запитання
 * 5. /api/docs — документація
 *
 * Auth: Bearer JWT
 * Rate Limiting: 100 req/min
 */

/**
 * API Response wrapper.
 */
export type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
};

/**
 * Успішна відповідь.
 */
export function apiSuccess<T>(data: T, meta?: Record<string, unknown>): Response {
  return Response.json({
    ok: true,
    data,
    meta,
  } as ApiResponse<T>);
}

/**
 * Відповідь з помилкою.
 */
export function apiError(error: string, status: number = 400): Response {
  return Response.json(
    { ok: false, error },
    { status },
  );
}

/**
 * Paginated response.
 */
export function apiPaginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): Response {
  return Response.json({
    ok: true,
    data,
    meta: { page, limit, total },
  });
}
