/**
 * Smart Service Mesh — мережа сервісів для мікроархітектури.
 *
 * Функції:
 * 1. Service-to-service communication
 * 2. Circuit breaking
 * 3. Retry logic
 * 4. Observability
 */

export type ServiceMeshConfig = {
  retryAttempts: number;
  retryDelayMs: number;
  circuitBreakerThreshold: number;
  timeoutMs: number;
};

export class ServiceMesh {
  private config: ServiceMeshConfig;
  private circuitBreakers = new Map<string, { failures: number; lastFailure: number; open: boolean }>();

  constructor(config: Partial<ServiceMeshConfig> = {}) {
    this.config = {
      retryAttempts: config.retryAttempts ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      timeoutMs: config.timeoutMs ?? 10_000,
    };
  }

  /**
   * Викликати сервіс з retry та circuit breaker.
   */
  async call<T>(
    serviceName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Check circuit breaker
    const cb = this.circuitBreakers.get(serviceName);
    if (cb?.open) {
      if (Date.now() - cb.lastFailure > 30_000) {
        // Try half-open
        cb.open = false;
        cb.failures = 0;
      } else {
        throw new Error(`Circuit breaker open for ${serviceName}`);
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), this.config.timeoutMs),
          ),
        ]);

        // Success — reset circuit breaker
        this.circuitBreakers.delete(serviceName);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Record failure
        const cbState = this.circuitBreakers.get(serviceName) ?? { failures: 0, lastFailure: 0, open: false };
        cbState.failures++;
        cbState.lastFailure = Date.now();

        if (cbState.failures >= this.config.circuitBreakerThreshold) {
          cbState.open = true;
        }

        this.circuitBreakers.set(serviceName, cbState);

        if (attempt < this.config.retryAttempts) {
          await new Promise((r) => setTimeout(r, this.config.retryDelayMs * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }

  /**
   * Отримати стан circuit breakers.
   */
  getCircuitBreakerStatus(): Record<string, { failures: number; open: boolean }> {
    const status: Record<string, { failures: number; open: boolean }> = {};
    for (const [name, cb] of this.circuitBreakers) {
      status[name] = { failures: cb.failures, open: cb.open };
    }
    return status;
  }
}
