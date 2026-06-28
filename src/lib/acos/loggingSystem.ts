/**
 * Smart API Logging — логування API запитів та відповідей.
 *
 * Рівні:
 * 1. DEBUG — відлагодження
 * 2. INFO — інформація
 * 3. WARN — попередження
 * 4. ERROR — помилки
 * 5. FATAL — критичні помилки
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogContext = {
  requestId?: string;
  userId?: string;
  tenantId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

let currentLevel: LogLevel = "info";

/**
 * Встановити рівень логування.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Отримати поточний рівень.
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Логувати повідомлення.
 */
export function log(
  level: LogLevel,
  message: string,
  context?: LogContext,
): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  switch (level) {
    case "debug":
      console.debug(JSON.stringify(entry));
      break;
    case "info":
      console.info(JSON.stringify(entry));
      break;
    case "warn":
      console.warn(JSON.stringify(entry));
      break;
    case "error":
    case "fatal":
      console.error(JSON.stringify(entry));
      break;
  }
}

/**
 * Логувати запит.
 */
export function logRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  context?: LogContext,
): void {
  const level: LogLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

  log(level, `${method} ${path} ${statusCode} ${duration}ms`, {
    ...context,
    method,
    endpoint: path,
    statusCode,
    duration,
  });
}

/**
 * Логувати помилку.
 */
export function logError(
  error: Error,
  context?: LogContext,
): void {
  log("error", error.message, {
    ...context,
    endpoint: context?.endpoint,
  });
}
