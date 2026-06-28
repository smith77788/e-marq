/**
 * Smart Idempotency System — запобігання повторним операціям.
 *
 * Використання:
 * 1. Payment processing — обробка платежів
 * 2. Order creation — створення замовлень
 * 3. Email sending — відправка листів
 * 4. Webhook delivery — доставка вебхуків
 */

const idempotencyKeys = new Map<string, { result: unknown; expires: number }>();

/**
 * Генерувати idempotency key.
 */
export function generateIdempotencyKey(
  prefix: string,
  params: Record<string, unknown>,
): string {
  const sorted = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("&");
  return `${prefix}:${sorted}`;
}

/**
 * Перевірити чи операція вже виконана.
 */
export function isAlreadyProcessed(key: string): boolean {
  const entry = idempotencyKeys.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expires) {
    idempotencyKeys.delete(key);
    return false;
  }
  return true;
}

/**
 * Зберегти результат операції.
 */
export function saveResult(
  key: string,
  result: unknown,
  ttlMs: number = 24 * 3600 * 1000,
): void {
  idempotencyKeys.set(key, {
    result,
    expires: Date.now() + ttlMs,
  });
}

/**
 * Отримати збережений результат.
 */
export function getResult<T>(key: string): T | null {
  const entry = idempotencyKeys.get(key);
  if (!entry || Date.now() > entry.expires) {
    idempotencyKeys.delete(key);
    return null;
  }
  return entry.result as T;
}

/**
 * Виконати з ідемпотентністю.
 */
export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = 24 * 3600 * 1000,
): Promise<T> {
  const existing = getResult<T>(key);
  if (existing !== null) return existing;

  const result = await fn();
  saveResult(key, result, ttlMs);
  return result;
}

// ─── Async Supabase-backed idempotency ────────────────────────

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Async check whether an operation was already processed (Supabase-backed).
 */
export async function asyncIsAlreadyProcessed(key: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("idempotency_keys" as never)
    .select("expires_at")
    .eq("key", key)
    .maybeSingle();

  if (!data) return false;
  if (Date.now() > (data as { expires_at: number }).expires_at) {
    await supabaseAdmin.from("idempotency_keys" as never).delete().eq("key", key);
    return false;
  }
  return true;
}

/**
 * Async save operation result (Supabase-backed).
 */
export async function asyncSaveResult(
  key: string,
  result: unknown,
  ttlMs: number = 24 * 3600 * 1000,
): Promise<void> {
  await supabaseAdmin.from("idempotency_keys" as never).upsert({
    key,
    result: JSON.stringify(result),
    expires_at: Date.now() + ttlMs,
  } as never);
}

/**
 * Async get saved result (Supabase-backed).
 */
export async function asyncGetResult<T>(key: string): Promise<T | null> {
  const { data } = await supabaseAdmin
    .from("idempotency_keys" as never)
    .select("result, expires_at")
    .eq("key", key)
    .maybeSingle();

  if (!data) return null;
  if (Date.now() > (data as { expires_at: number }).expires_at) {
    await supabaseAdmin.from("idempotency_keys" as never).delete().eq("key", key);
    return null;
  }
  return JSON.parse((data as { result: string }).result) as T;
}

/**
 * Async execute with idempotency (Supabase-backed).
 */
export async function asyncWithIdempotency<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = 24 * 3600 * 1000,
): Promise<T> {
  const existing = await asyncGetResult<T>(key);
  if (existing !== null) return existing;

  const result = await fn();
  await asyncSaveResult(key, result, ttlMs);
  return result;
}
