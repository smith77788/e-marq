/**
 * Smart API Metrics — метрики API продуктивності.
 *
 * Метрики:
 * 1. Request count — кількість запитів
 * 2. Response time — час відповіді
 * 3. Error rate — частота помилок
 * 4. Throughput — пропускна здатність
 * 5. Latency percentiles — перцентилі затримки
 */

export type ApiMetrics = {
  requests: {
    total: number;
    perMinute: number;
    perEndpoint: Record<string, number>;
  };
  responseTime: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  errors: {
    total: number;
    rate: number;
    byType: Record<string, number>;
  };
  uptime: number;
};

const metricsData = {
  requests: [] as Array<{ timestamp: number; endpoint: string; status: number; duration: number }>,
};

/**
 * Записати метрику запиту.
 */
export function recordApiMetric(
  endpoint: string,
  status: number,
  duration: number,
): void {
  metricsData.requests.push({
    timestamp: Date.now(),
    endpoint,
    status,
    duration,
  });

  // Зберігати лише останні 10000 запитів
  if (metricsData.requests.length > 10000) {
    metricsData.requests = metricsData.requests.slice(-10000);
  }
}

/**
 * Отримати метрики.
 */
export function getApiMetrics(): ApiMetrics {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  const recentRequests = metricsData.requests.filter((r) => r.timestamp > oneMinuteAgo);
  const durations = metricsData.requests.map((r) => r.duration).sort((a, b) => a - b);
  const errors = metricsData.requests.filter((r) => r.status >= 400);

  const endpointCounts: Record<string, number> = {};
  for (const r of recentRequests) {
    endpointCounts[r.endpoint] = (endpointCounts[r.endpoint] ?? 0) + 1;
  }

  return {
    requests: {
      total: metricsData.requests.length,
      perMinute: recentRequests.length,
      perEndpoint: endpointCounts,
    },
    responseTime: {
      avg: durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0,
      p50: durations[Math.floor(durations.length * 0.5)] ?? 0,
      p95: durations[Math.floor(durations.length * 0.95)] ?? 0,
      p99: durations[Math.floor(durations.length * 0.99)] ?? 0,
    },
    errors: {
      total: errors.length,
      rate: metricsData.requests.length > 0 ? (errors.length / metricsData.requests.length) * 100 : 0,
      byType: {},
    },
    uptime: process.uptime(),
  };
}
