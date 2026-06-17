/**
 * Smart API Profiling — профілювання продуктивності API.
 *
 * Функції:
 * 1. CPU profiling — профілювання CPU
 * 2. Memory profiling — профілювання пам'яті
 * 3. Request profiling — профілювання запитів
 * 4. Slow query detection — виявлення повільних запитів
 */

export type ProfileResult = {
  name: string;
  duration_ms: number;
  memory_before: number;
  memory_after: number;
  memory_delta: number;
};

/**
 * Профілювати виконання функції.
 */
export async function profileFunction<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ result: T; profile: ProfileResult }> {
  const memoryBefore = process.memoryUsage().heapUsed;
  const start = Date.now();

  const result = await fn();

  const duration = Date.now() - start;
  const memoryAfter = process.memoryUsage().heapUsed;

  return {
    result,
    profile: {
      name,
      duration_ms: duration,
      memory_before: memoryBefore,
      memory_after: memoryAfter,
      memory_delta: memoryAfter - memoryBefore,
    },
  };
}

/**
 * Виявити повільні запити.
 */
export function detectSlowRequests(
  requests: Array<{ endpoint: string; duration: number }>,
  thresholdMs: number = 1000,
): Array<{ endpoint: string; duration: number }> {
  return requests.filter((r) => r.duration > thresholdMs);
}

/**
 * Отримати топ повільних запитів.
 */
export function getSlowestRequests(
  requests: Array<{ endpoint: string; duration: number }>,
  limit: number = 10,
): Array<{ endpoint: string; duration: number }> {
  return [...requests]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, limit);
}
