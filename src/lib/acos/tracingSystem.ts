/**
 * Smart API Tracing — трасування API запитів.
 *
 * Функції:
 * 1. Trace ID — унікальний ідентифікатор запиту
 * 2. Span tracking — відстеження операцій
 * 3. Duration timing — вимірювання часу
 * 4. Error attribution — визначення помилок
 */

export type TraceSpan = {
  id: string;
  name: string;
  startMs: number;
  endMs?: number;
  duration?: number;
  status: "ok" | "error";
  error?: string;
  parentSpanId?: string;
};

export type TraceContext = {
  traceId: string;
  spans: TraceSpan[];
  startTime: number;
  endTime?: number;
  totalDuration?: number;
};

/**
 * Створити трасувальний контекст.
 */
export function createTrace(): TraceContext {
  return {
    traceId: crypto.randomUUID(),
    spans: [],
    startTime: Date.now(),
  };
}

/**
 * Почати span.
 */
export function startSpan(
  context: TraceContext,
  name: string,
  parentSpanId?: string,
): string {
  const spanId = crypto.randomUUID();
  context.spans.push({
    id: spanId,
    name,
    startMs: Date.now(),
    status: "ok",
    parentSpanId,
  });
  return spanId;
}

/**
 * Завершити span.
 */
export function endSpan(
  context: TraceContext,
  spanId: string,
  status: "ok" | "error" = "ok",
  error?: string,
): void {
  const span = context.spans.find((s) => s.id === spanId);
  if (span) {
    span.endMs = Date.now();
    span.duration = span.endMs - span.startMs;
    span.status = status;
    if (error) span.error = error;
  }
}

/**
 * Завершити трасування.
 */
export function endTrace(context: TraceContext): void {
  context.endTime = Date.now();
  context.totalDuration = context.endTime - context.startTime;
}

/**
 * Отримати трасування у форматі JSON.
 */
export function getTraceJson(context: TraceContext): Record<string, unknown> {
  return {
    traceId: context.traceId,
    duration: context.totalDuration,
    spans: context.spans.map((s) => ({
      name: s.name,
      duration: s.duration,
      status: s.status,
      error: s.error,
    })),
  };
}
