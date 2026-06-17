/**
 * Smart API v2 — покращена система API.
 *
 * Можливості:
 * 1. Versioning — версіонування API
 * 2. Rate limiting — обмеження частоти
 * 3. Authentication — автентифікація
 * 4. Validation — валідація
 * 5. Error handling — обробка помилок
 */

export type ApiVersion = "v1" | "v2";

export type ApiRequest = {
  version: ApiVersion;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
};

export type ApiResponseV2<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    version: ApiVersion;
    timestamp: string;
    requestId: string;
  };
};

/**
 * Створити відповідь API v2.
 */
export function apiResponse<T>(
  data: T,
  options?: { version?: ApiVersion },
): Response {
  return Response.json({
    ok: true,
    data,
    meta: {
      version: options?.version ?? "v2",
      timestamp: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    },
  } as ApiResponseV2<T>);
}

/**
 * Створити відповідь з помилкою API v2.
 */
export function apiErrorV2(
  code: string,
  message: string,
  details?: unknown,
  status: number = 400,
): Response {
  return Response.json(
    {
      ok: false,
      error: { code, message, details },
      meta: {
        version: "v2" as ApiVersion,
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      },
    } as ApiResponseV2,
    { status },
  );
}
