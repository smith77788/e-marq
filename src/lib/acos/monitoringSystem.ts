/**
 * Smart API Monitoring — моніторинг API запитів.
 *
 * Метрики:
 * 1. Request count — кількість запитів
 * 2. Response time — час відповіді
 * 3. Error rate — частота помилок
 * 4. Throughput — пропускна здатність
 */

export type ApiMetric = {
  endpoint: string;
  method: string;
  count: number;
  avgResponseTime: number;
  errorRate: number;
  lastRequest: string;
};

const metrics = new Map<string, {
  count: number;
  totalTime: number;
  errors: number;
  lastRequest: number;
}>();

/**
 * Записати метрику запиту.
 */
export function recordRequest(
  method: string,
  path: string,
  responseTime: number,
  isError: boolean,
): void {
  const key = `${method}:${path}`;
  const entry = metrics.get(key) ?? { count: 0, totalTime: 0, errors: 0, lastRequest: 0 };

  entry.count++;
  entry.totalTime += responseTime;
  if (isError) entry.errors++;
  entry.lastRequest = Date.now();

  metrics.set(key, entry);
}

/**
 * Отримати метрики.
 */
export function getMetrics(): ApiMetric[] {
  return Array.from(metrics.entries()).map(([key, data]) => {
    const [method, endpoint] = key.split(":");
    return {
      endpoint,
      method,
      count: data.count,
      avgResponseTime: data.count > 0 ? Math.round(data.totalTime / data.count) : 0,
      errorRate: data.count > 0 ? (data.errors / data.count) * 100 : 0,
      lastRequest: new Date(data.lastRequest).toISOString(),
    };
  });
}

/**
 * Очистити метрики.
 */
export function clearMetrics(): void {
  metrics.clear();
}
