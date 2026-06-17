/**
 * Smart Retry System — централізована система повторних спроб.
 *
 * Стратегії:
 * 1. Immediate — негайний повтор
 * 2. Exponential Backoff — експоненційний відступ
 * 3. Linear Backoff — лінійний відступ
 * 4. Fixed Delay — фіксована затримка
 */

export type RetryConfig = {
  maxRetries: number;
  strategy: "immediate" | "exponential" | "linear" | "fixed";
  baseDelayMs: number;
  maxDelayMs: number;
};

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  strategy: "exponential",
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

/**
 * Виконати з retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < cfg.maxRetries) {
        const delay = calculateDelay(attempt, cfg);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  switch (config.strategy) {
    case "immediate":
      return 0;
    case "exponential":
      return Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
    case "linear":
      return Math.min(config.baseDelayMs * (attempt + 1), config.maxDelayMs);
    case "fixed":
      return config.baseDelayMs;
    default:
      return config.baseDelayMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
