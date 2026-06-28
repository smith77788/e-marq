/**
 * Smart Rate Limit System — централізована система обмеження частоти.
 *
 * Стратегії:
 * 1. Fixed Window — фіксоване вікно
 * 2. Sliding Window — ковзне вікно
 * 3. Token Bucket — відро токенів
 * 4. Leaky Bucket — відро з витоком
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
  tokens?: number;
  lastRefill?: number;
};

const store = new Map<string, RateLimitEntry>();

/**
 * Fixed Window Rate Limiter.
 */
export function fixedWindowRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count++;
  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Token Bucket Rate Limiter.
 */
export function tokenBucketRateLimit(
  key: string,
  maxTokens: number,
  refillRate: number, // tokens per second
): { allowed: boolean; tokens: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) {
    store.set(key, { count: 0, resetAt: 0, tokens: maxTokens - 1, lastRefill: now });
    return { allowed: true, tokens: maxTokens - 1 };
  }

  // Refill tokens
  const elapsed = (now - (entry.lastRefill ?? now)) / 1000;
  const refill = Math.floor(elapsed * refillRate);
  entry.tokens = Math.min(maxTokens, (entry.tokens ?? maxTokens) + refill);
  entry.lastRefill = now;

  if (entry.tokens > 0) {
    entry.tokens--;
    return { allowed: true, tokens: entry.tokens };
  }

  return { allowed: false, tokens: 0 };
}

/**
 * Очистити застарілі записи.
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt + 60_000) {
      store.delete(key);
    }
  }
}

// ─── Async Supabase-backed rate limiters ──────────────────────

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Async Fixed Window Rate Limiter backed by Supabase (rate_limit_counters table).
 */
export async function asyncFixedWindowRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const resetAt = now + windowMs;

  const { data: existing } = await supabaseAdmin
    .from("rate_limit_counters" as never)
    .select("count, reset_at")
    .eq("key", key)
    .maybeSingle();

  if (!existing || now > (existing as { reset_at: number }).reset_at) {
    await supabaseAdmin.from("rate_limit_counters" as never).upsert({
      key,
      count: 1,
      reset_at: resetAt,
    } as never);
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  const currentCount = (existing as { count: number }).count + 1;
  await supabaseAdmin
    .from("rate_limit_counters" as never)
    .update({ count: currentCount } as never)
    .eq("key", key);

  return {
    allowed: currentCount <= maxRequests,
    remaining: Math.max(0, maxRequests - currentCount),
    resetAt: (existing as { reset_at: number }).reset_at,
  };
}

/**
 * Async Token Bucket Rate Limiter backed by Supabase.
 */
export async function asyncTokenBucketRateLimit(
  key: string,
  maxTokens: number,
  refillRate: number,
): Promise<{ allowed: boolean; tokens: number }> {
  const now = Date.now();

  const { data: existing } = await supabaseAdmin
    .from("rate_limit_counters" as never)
    .select("tokens, last_refill")
    .eq("key", key)
    .maybeSingle();

  if (!existing) {
    await supabaseAdmin.from("rate_limit_counters" as never).upsert({
      key,
      tokens: maxTokens - 1,
      last_refill: now,
    } as never);
    return { allowed: true, tokens: maxTokens - 1 };
  }

  const lastRefill = (existing as { last_refill: number }).last_refill ?? now;
  const elapsed = (now - lastRefill) / 1000;
  const refill = Math.floor(elapsed * refillRate);
  const tokens = Math.min(maxTokens, (existing as { tokens: number }).tokens + refill);

  if (tokens > 0) {
    await supabaseAdmin
      .from("rate_limit_counters" as never)
      .update({ tokens: tokens - 1, last_refill: now } as never)
      .eq("key", key);
    return { allowed: true, tokens: tokens - 1 };
  }

  return { allowed: false, tokens: 0 };
}
