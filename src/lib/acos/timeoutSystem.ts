/**
 * Smart Timeout System — система обмеження часу виконання.
 *
 * Функції:
 * 1. withTimeout — обмеження часу виконання
 * 2. withDeadline — дедлайн
 * 3. withCancellation — скасування
 */

/**
 * Обмежити час виконання.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string = "Operation timed out",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Виконати з AbortSignal.
 */
export async function withAbortSignal<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await fn(controller.signal);
    clearTimeout(timer);
    return result;
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new Error("Operation aborted due to timeout");
    }
    throw error;
  }
}
