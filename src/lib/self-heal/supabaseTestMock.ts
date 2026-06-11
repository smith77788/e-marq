/**
 * Test-only helper: a chainable, awaitable fake of the Supabase query builder.
 *
 * Only imported by *.test.ts files, so it is excluded from the production build.
 * Every builder method returns the same builder (so chains like
 * `.select().eq().lt().limit()` work), and the builder is a thenable that
 * resolves to a preconfigured result — matching how `supabaseAdmin` is awaited
 * across the self-heal code (`const { data } = await supabaseAdmin.from(...)...`).
 */

export type QueryResult = { data?: unknown; count?: number; error?: unknown };

export type Call = { table: string; method: string; args: unknown[] };

const CHAIN_METHODS = [
  "select",
  "insert",
  "update",
  "upsert",
  "delete",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is",
  "order",
  "limit",
  "range",
] as const;

export function makeBuilder(result: QueryResult, table: string, calls?: Call[]) {
  const resolved = Promise.resolve(result);
  const builder: Record<string, unknown> = {};
  const record = (method: string) =>
    (...args: unknown[]) => {
      calls?.push({ table, method, args });
      return builder;
    };
  for (const m of CHAIN_METHODS) builder[m] = record(m);
  // Terminal single-row accessors return a real promise of the result.
  builder.maybeSingle = (...args: unknown[]) => {
    calls?.push({ table, method: "maybeSingle", args });
    return Promise.resolve(result);
  };
  builder.single = (...args: unknown[]) => {
    calls?.push({ table, method: "single", args });
    return Promise.resolve(result);
  };
  // Thenable: awaiting the builder resolves to the configured result.
  builder.then = (onF: ((v: QueryResult) => unknown) | undefined, onR?: (e: unknown) => unknown) =>
    resolved.then(onF, onR);
  builder.catch = (onR: (e: unknown) => unknown) => resolved.catch(onR);
  return builder;
}

/**
 * Build a `from(table)` implementation that yields per-table results.
 * A plain value is reused for every call to that table; an array is a queue
 * consumed in order across successive `from(table)` calls (the last item
 * sticks once the queue is down to one). Unlisted tables resolve to empty.
 */
export function routeTables(
  plan: Record<string, QueryResult | QueryResult[]>,
  calls?: Call[],
) {
  const queues: Record<string, QueryResult[]> = {};
  for (const [t, v] of Object.entries(plan)) queues[t] = Array.isArray(v) ? [...v] : [v];
  return (table: string) => {
    const q = queues[table] ?? [];
    const result = q.length > 1 ? (q.shift() as QueryResult) : (q[0] ?? { data: [], count: 0 });
    return makeBuilder(result, table, calls);
  };
}
