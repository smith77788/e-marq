/**
 * Smart URL System — операції з URL.
 *
 * Функції:
 * 1. Парсинг URL
 * 2. Генерація query params
 * 3. Валідація URL
 * 4. Безпечний fetch
 */

/**
 * Парсити URL.
 */
export function parseUrl(url: string): {
  protocol: string;
  host: string;
  pathname: string;
  search: Record<string, string>;
  hash: string;
} | null {
  try {
    const parsed = new URL(url);
    const search: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      search[key] = value;
    });
    return {
      protocol: parsed.protocol,
      host: parsed.host,
      pathname: parsed.pathname,
      search,
      hash: parsed.hash,
    };
  } catch {
    return null;
  }
}

/**
 * Побудувати URL з query params.
 */
export function buildUrl(
  base: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Валідувати URL.
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Безпечний fetch з таймаутом.
 */
export async function safeFetch(
  url: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 10_000, ...fetchOptions } = options ?? {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new Error("Request timed out");
    }
    throw error;
  }
}
