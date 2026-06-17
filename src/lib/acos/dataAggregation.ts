/**
 * Smart Data Aggregation — агрегація даних для швидкого доступу.
 *
 * Кешує:
 * 1. Revenue metrics (кеш: 5 хв)
 * 2. Customer metrics (кеш: 15 хв)
 * 3. Product metrics (кеш: 30 хв)
 * 4. Agent metrics (кеш: 1 хв)
 */
const cache = new Map<string, { data: unknown; expires: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

/**
 * Отримати кешовані revenue метрики.
 */
export async function getCachedRevenueMetrics(
  tenantId: string,
  fetcher: () => Promise<unknown>,
): Promise<unknown> {
  const key = `revenue:${tenantId}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await fetcher();
  setCached(key, data, 5 * 60 * 1000); // 5 хвилин
  return data;
}

/**
 * Отримати кешовані customer метрики.
 */
export async function getCachedCustomerMetrics(
  tenantId: string,
  fetcher: () => Promise<unknown>,
): Promise<unknown> {
  const key = `customers:${tenantId}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await fetcher();
  setCached(key, data, 15 * 60 * 1000); // 15 хвилин
  return data;
}

/**
 * Очистити кеш для тенанта.
 */
export function clearCache(tenantId: string): void {
  for (const key of cache.keys()) {
    if (key.includes(tenantId)) {
      cache.delete(key);
    }
  }
}
