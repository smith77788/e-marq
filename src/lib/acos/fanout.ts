/**
 * Спільні примітиви для cron fan-out оркестраторів (cron-all / run-all /
 * cron-chunk): обмеження конкуренції та виклики внутрішніх хуків з таймаутом.
 *
 * Без них fan-out запускав до ~800 одночасних fetch'ів без таймауту, а
 * оркестратори відповідали 200 навіть при повному відказі — моніторинг
 * і pg_cron бачили «зелено».
 */

/** Таймаут одного виклику агента. */
export const AGENT_CALL_TIMEOUT_MS = 120_000;
/** Таймаут вкладеного виклику run-all (цілий tenant: десятки агентів). */
export const RUN_ALL_CALL_TIMEOUT_MS = 600_000;
/** Скільки tenant'ів обробляємо одночасно. */
export const TENANT_FANOUT_CONCURRENCY = 5;
/** Скільки агентів одного tenant'а викликаємо одночасно. */
export const AGENT_FANOUT_CONCURRENCY = 10;

/**
 * Drop-in заміна `Promise.allSettled(items.map(fn))` з обмеженням
 * кількості одночасних викликів. Порядок результатів збережено.
 */
export async function allSettledWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export type HookCallResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  error?: string;
};

/**
 * POST на внутрішній хук з Bearer-токеном і таймаутом. Ніколи не кидає:
 * мережеві помилки й таймаути повертаються як { ok: false, error }.
 */
export async function callHook(
  origin: string,
  path: string,
  token: string,
  payload: Record<string, unknown>,
  timeoutMs: number = AGENT_CALL_TIMEOUT_MS,
): Promise<HookCallResult> {
  try {
    const res = await fetch(`${origin}/hooks/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * true, якщо fan-out зробив ≥1 виклик і УСІ вони провалились — тоді
 * оркестратор має відповісти 5xx, щоб pg_cron/моніторинг побачили відказ.
 * Часткові відмови лишаються 200 (повторний запуск пройде по retry-логіці
 * самих агентів, а не перезапустить успішні).
 */
export function isTotalFailure(outcomes: ReadonlyArray<{ ok: boolean }>): boolean {
  return outcomes.length > 0 && outcomes.every((o) => !o.ok);
}
