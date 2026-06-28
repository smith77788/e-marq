/**
 * Smart API Load Testing — навантажувальне тестування API.
 *
 * Функції:
 * 1. Concurrent requests — паралельні запити
 * 2. Ramp up — плавне нарощування
 * 3. Stress testing — стрес-тестування
 * 4. Metrics collection — збір метрик
 */

export type LoadTestConfig = {
  url: string;
  method: string;
  concurrent: number;
  totalRequests: number;
  rampUpMs?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export type LoadTestResult = {
  totalRequests: number;
  successful: number;
  failed: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p95ResponseTime: number;
  duration: number;
  requestsPerSecond: number;
};

/**
 * Запустити навантажувальний тест.
 */
export async function runLoadTest(
  config: LoadTestConfig,
): Promise<LoadTestResult> {
  const results: Array<{ success: boolean; duration: number }> = [];
  const startTime = Date.now();

  // Розбити на батчі
  const batchSize = config.concurrent;
  const batches = Math.ceil(config.totalRequests / batchSize);

  for (let batch = 0; batch < batches; batch++) {
    const batchSizeActual = Math.min(batchSize, config.totalRequests - batch * batchSize);
    const promises: Promise<void>[] = [];

    for (let i = 0; i < batchSizeActual; i++) {
      promises.push(
        makeRequest(config).then((result) => {
          results.push(result);
        }),
      );
    }

    await Promise.all(promises);

    // Рамп-ап затримка
    if (config.rampUpMs && batch < batches - 1) {
      await new Promise((r) => setTimeout(r, config.rampUpMs));
    }
  }

  const duration = Date.now() - startTime;
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const durations = results.map((r) => r.duration).sort((a, b) => a - b);

  return {
    totalRequests: results.length,
    successful,
    failed,
    avgResponseTime: durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0,
    minResponseTime: durations[0] ?? 0,
    maxResponseTime: durations[durations.length - 1] ?? 0,
    p95ResponseTime: durations[Math.floor(durations.length * 0.95)] ?? 0,
    duration,
    requestsPerSecond: duration > 0 ? (results.length / duration) * 1000 : 0,
  };
}

async function makeRequest(
  config: LoadTestConfig,
): Promise<{ success: boolean; duration: number }> {
  const start = Date.now();
  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    return {
      success: response.ok,
      duration: Date.now() - start,
    };
  } catch {
    return {
      success: false,
      duration: Date.now() - start,
    };
  }
}
