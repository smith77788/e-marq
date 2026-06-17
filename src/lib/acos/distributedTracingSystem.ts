/**
 * Smart Distributed Tracing — розподілене трасування між сервісами.
 *
 * Функції:
 * 1. Trace propagation — передача trace context
 * 2. Span creation — створення span'ів
 * 3. Baggage — додаткові дані
 * 4. Sampling — вибірка трасувань
 */

export type TraceContextV2 = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  baggage?: Record<string, string>;
  sampled: boolean;
};

/**
 * Створити trace context.
 */
export function createTraceContext(
  baggage?: Record<string, string>,
): TraceContextV2 {
  return {
    traceId: crypto.randomUUID(),
    spanId: crypto.randomUUID().slice(0, 16),
    baggage,
    sampled: Math.random() < 0.1, // 10% sampling
  };
}

/**
 * Створити child span.
 */
export function createChildSpan(
  parent: TraceContextV2,
  baggage?: Record<string, string>,
): TraceContextV2 {
  return {
    traceId: parent.traceId,
    spanId: crypto.randomUUID().slice(0, 16),
    parentSpanId: parent.spanId,
    baggage: { ...parent.baggage, ...baggage },
    sampled: parent.sampled,
  };
}

/**
 * Серіалізувати context для передачі заголовками.
 */
export function serializeTraceContext(context: TraceContextV2): string {
  const parts = [
    `trace-id=${context.traceId}`,
    `span-id=${context.spanId}`,
  ];

  if (context.parentSpanId) {
    parts.push(`parent-span-id=${context.parentSpanId}`);
  }

  if (context.baggage && Object.keys(context.baggage).length > 0) {
    const baggageStr = Object.entries(context.baggage)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join(",");
    parts.push(`baggage=${baggageStr}`);
  }

  return parts.join("; ");
}

/**
 * Десеріалізувати context з заголовка.
 */
export function deserializeTraceContext(header: string): TraceContextV2 | null {
  try {
    const parts = Object.fromEntries(
      header.split(";").map((part) => {
        const [key, ...valueParts] = part.trim().split("=");
        return [key.trim(), valueParts.join("=").trim()];
      }),
    );

    if (!parts["trace-id"] || !parts["span-id"]) return null;

    const baggage: Record<string, string> = {};
    if (parts.baggage) {
      for (const item of parts.baggage.split(",")) {
        const [k, v] = item.split("=");
        if (k && v) baggage[k] = decodeURIComponent(v);
      }
    }

    return {
      traceId: parts["trace-id"],
      spanId: parts["span-id"],
      parentSpanId: parts["parent-span-id"],
      baggage: Object.keys(baggage).length > 0 ? baggage : undefined,
      sampled: true,
    };
  } catch {
    return null;
  }
}

/**
 * Додати trace context до заголовків запиту.
 */
export function injectTraceHeaders(
  headers: Record<string, string>,
  context: TraceContextV2,
): Record<string, string> {
  return {
    ...headers,
    "X-Trace-Id": context.traceId,
    "X-Span-Id": context.spanId,
    "X-Trace-Sampled": context.sampled ? "true" : "false",
  };
}
