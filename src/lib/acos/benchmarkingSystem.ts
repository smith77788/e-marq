/**
 * Smart API Benchmarking — бенчмаркинг API продуктивності.
 *
 * Тести:
 * 1. Throughput — пропускна здатність
 * 2. Latency — затримка
 * 3. Concurrency — паралельність
 * 4. Memory — пам'ять
 */

export type BenchmarkResult = {
  name: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
  memoryUsed: number;
};

/**
 * Запустити бенчмарк.
 */
export async function runBenchmark(
  name: string,
  fn: () => Promise<void>,
  iterations: number = 1000,
): Promise<BenchmarkResult> {
  const memBefore = process.memoryUsage().heapUsed;
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  const totalTime = times.reduce((s, t) => s + t, 0);
  const sorted = times.sort((a, b) => a - b);
  const memAfter = process.memoryUsage().heapUsed;

  return {
    name,
    iterations,
    totalTime,
    avgTime: totalTime / iterations,
    minTime: sorted[0],
    maxTime: sorted[sorted.length - 1],
    opsPerSecond: 1000 / (totalTime / iterations),
    memoryUsed: memAfter - memBefore,
  };
}

/**
 * Порівняти бенчмарки.
 */
export function compareBenchmarks(
  a: BenchmarkResult,
  b: BenchmarkResult,
): { faster: string; speedup: number } {
  const speedup = a.avgTime / b.avgTime;
  return {
    faster: speedup > 1 ? b.name : a.name,
    speedup: Math.abs(speedup),
  };
}
