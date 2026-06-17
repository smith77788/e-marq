/**
 * Smart API Stress Testing — стрес-тестування API.
 *
 * Сценарії:
 * 1. Spike — раптове навантаження
 * 2. Soak — тривале навантаження
 * 3. Step — поступове нарощування
 */

export type StressTestConfig = {
  url: string;
  method: string;
  maxConcurrent: number;
  duration: number; // ms
  rampUpInterval: number; // ms
  rampUpStep: number;
};

export type StressTestResult = {
  totalRequests: number;
  successful: number;
  failed: number;
  peakConcurrent: number;
  avgResponseTime: number;
  errorRate: number;
  duration: number;
};

/**
 * Spike тест — раптове навантаження.
 */
export async function runSpikeTest(
  config: StressTestConfig,
): Promise<StressTestResult> {
  return runStressTest({
    ...config,
    rampUpInterval: 0,
    rampUpStep: config.maxConcurrent,
  });
}

/**
 * Soak тест — тривале навантаження.
 */
export async function runSoakTest(
  config: StressTestConfig,
): Promise<StressTestResult> {
  return runStressTest({
    ...config,
    rampUpInterval: config.duration / 10,
    rampUpStep: Math.ceil(config.maxConcurrent / 10),
  });
}

/**
 * Step тест — поступове нарощування.
 */
export async function runStepTest(
  config: StressTestConfig,
): Promise<StressTestResult> {
  return runStressTest(config);
}

async function runStressTest(
  config: StressTestConfig,
): Promise<StressTestResult> {
  const startTime = Date.now();
  let totalRequests = 0;
  let successful = 0;
  let failed = 0;
  let peakConcurrent = 0;
  let currentConcurrent = 0;
  const responseTimes: number[] = [];

  while (Date.now() - startTime < config.duration) {
    // Нарощувати навантаження
    currentConcurrent = Math.min(
      currentConcurrent + config.rampUpStep,
      config.maxConcurrent,
    );
    peakConcurrent = Math.max(peakConcurrent, currentConcurrent);

    // Відправити запити
    const promises: Promise<void>[] = [];
    for (let i = 0; i < currentConcurrent; i++) {
      promises.push(
        makeStressRequest(config.url, config.method).then((result) => {
          totalRequests++;
          if (result.success) successful++;
          else failed++;
          responseTimes.push(result.duration);
        }),
      );
    }

    await Promise.all(promises);

    // Затримка між хвилями
    await new Promise((r) => setTimeout(r, config.rampUpInterval));
  }

  const duration = Date.now() - startTime;
  const sortedTimes = responseTimes.sort((a, b) => a - b);

  return {
    totalRequests,
    successful,
    failed,
    peakConcurrent,
    avgResponseTime: responseTimes.length > 0
      ? responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length
      : 0,
    errorRate: totalRequests > 0 ? (failed / totalRequests) * 100 : 0,
    duration,
  };
}

async function makeStressRequest(
  url: string,
  method: string,
): Promise<{ success: boolean; duration: number }> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(10_000),
    });
    return { success: response.ok, duration: Date.now() - start };
  } catch {
    return { success: false, duration: Date.now() - start };
  }
}
