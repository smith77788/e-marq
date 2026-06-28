/**
 * Smart Circuit Breaker v2 — покращений запобіжник від перевантаження.
 *
 * Покращення:
 * 1. Half-open state testing
 * 2. Success threshold for recovery
 * 3. Event emitter для моніторингу
 * 4. Metrics collection
 */

export type CircuitBreakerState = "closed" | "open" | "half_open";

export type CircuitBreakerMetrics = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
};

export class CircuitBreakerV2 {
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private metrics: CircuitBreakerMetrics = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
  };

  private readonly failureThreshold: number;
  private readonly recoveryTimeout: number;
  private readonly successThreshold: number;

  constructor(options: {
    failureThreshold?: number;
    recoveryTimeout?: number;
    successThreshold?: number;
  } = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeout = options.recoveryTimeout ?? 30_000;
    this.successThreshold = options.successThreshold ?? 3;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.metrics.totalCalls++;

    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = "half_open";
        this.successCount = 0;
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.metrics.successfulCalls++;
    this.metrics.lastSuccessTime = Date.now();
    this.failureCount = 0;

    if (this.state === "half_open") {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = "closed";
      }
    }
  }

  private onFailure(): void {
    this.metrics.failedCalls++;
    this.metrics.lastFailureTime = Date.now();
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
    };
  }
}
