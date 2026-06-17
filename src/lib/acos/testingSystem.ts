/**
 * Smart API Testing — тестування API ендпоінтів.
 *
 * Типи тестів:
 * 1. Unit Tests — модульні тести
 * 2. Integration Tests — інтеграційні тести
 * 3. E2E Tests — тести кінцевого користувача
 * 4. Load Tests — навантажувальні тести
 */

export type TestResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  duration_ms: number;
  error?: string;
};

export type TestSuite = {
  name: string;
  tests: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
};

/**
 * Запустити тест.
 */
export async function runTest(
  name: string,
  fn: () => Promise<void>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return {
      name,
      status: "pass",
      duration_ms: Date.now() - start,
    };
  } catch (e) {
    return {
      name,
      status: "fail",
      duration_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Запустити suite тестів.
 */
export async function runTestSuite(
  name: string,
  tests: Array<{ name: string; fn: () => Promise<void> }>,
): Promise<TestSuite> {
  const results: TestResult[] = [];

  for (const test of tests) {
    const result = await runTest(test.name, test.fn);
    results.push(result);
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  return {
    name,
    tests: results,
    passed,
    failed,
    skipped,
    duration_ms: results.reduce((s, r) => s + r.duration_ms, 0),
  };
}
