/**
 * Smart API Error Handling — обробка помилок API.
 *
 * Типи помилок:
 * 1. Validation Error — помилка валідації
 * 2. Authentication Error — помилка автентифікації
 * 3. Authorization Error — помилка авторизації
 * 4. Not Found — не знайдено
 * 5. Rate Limit — обмеження частоти
 * 6. Internal Error — внутрішня помилка
 */

export class ApiError extends Error {
  public code: string;
  public status: number;
  public details?: unknown;

  constructor(code: string, message: string, status: number = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMIT: "RATE_LIMIT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  CONFLICT: "CONFLICT",
  UNPROCESSABLE: "UNPROCESSABLE",
} as const;

/**
 * Створити помилку валідації.
 */
export function validationError(message: string, details?: unknown): ApiError {
  return new ApiError(ERROR_CODES.VALIDATION_ERROR, message, 400, details);
}

/**
 * Створити помилку автентифікації.
 */
export function authenticationError(message: string = "Unauthorized"): ApiError {
  return new ApiError(ERROR_CODES.AUTHENTICATION_ERROR, message, 401);
}

/**
 * Створити помилку авторизації.
 */
export function authorizationError(message: string = "Forbidden"): ApiError {
  return new ApiError(ERROR_CODES.AUTHORIZATION_ERROR, message, 403);
}

/**
 * Створити помилку "не знайдено".
 */
export function notFoundError(message: string = "Not Found"): ApiError {
  return new ApiError(ERROR_CODES.NOT_FOUND, message, 404);
}

/**
 * Створити помилку rate limit.
 */
export function rateLimitError(message: string = "Rate limit exceeded"): ApiError {
  return new ApiError(ERROR_CODES.RATE_LIMIT, message, 429);
}

/**
 * Створити внутрішню помилку.
 */
export function internalError(message: string = "Internal Server Error"): ApiError {
  return new ApiError(ERROR_CODES.INTERNAL_ERROR, message, 500);
}

/**
 * Обробити помилку в JSON відповідь.
 */
export function handleError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  return Response.json(
    {
      ok: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    },
    { status: 500 },
  );
}
