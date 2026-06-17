/**
 * Smart Queue System — централізована система черг.
 *
 * Типи черг:
 * 1. Email Queue — черга листів
 * 2. Notification Queue — черга сповіщень
 * 3. Webhook Queue — черга вебхуків
 * 4. Agent Queue — черга агентів
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type QueueItem = {
  id: string;
  queue: string;
  payload: unknown;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  max_attempts: number;
  created_at: string;
  processed_at?: string;
  error?: string;
};

/**
 * Додати до черги.
 */
export async function enqueue(
  queue: string,
  payload: unknown,
  options?: { maxAttempts?: number },
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: `queue_${queue}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fact_kind: "queue_item",
      tenant_id: "system",
      confidence: 1.0,
      source: "queue",
      value: {
        queue,
        payload,
        status: "pending",
        attempts: 0,
        max_attempts: options?.maxAttempts ?? 3,
      } as never,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Отримати наступний елемент з черги.
 */
export async function dequeue(
  queue: string,
): Promise<QueueItem | null> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("*")
    .eq("fact_kind", "queue_item")
    .order("created_at")
    .limit(50);

  const pending = (data ?? []).find((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return v.queue === queue && v.status === "pending" && (v.attempts as number) < 3;
  });

  if (!pending) return null;

  const v = (pending.value ?? {}) as Record<string, unknown>;
  const attempts = (v.attempts as number) + 1;

  await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: { ...v, status: "processing", attempts } as never })
    .eq("id", pending.id);

  return {
    id: pending.id,
    queue: v.queue as string,
    payload: v.payload,
    status: "processing",
    attempts,
    max_attempts: (v.max_attempts as number) ?? 3,
    created_at: pending.created_at,
  };
}

/**
 * Позначити як виконане.
 */
export async function completeItem(
  itemId: string,
): Promise<{ ok: boolean }> {
  const { data: row } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", itemId)
    .single();

  const v = (row?.value ?? {}) as Record<string, unknown>;
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: { ...v, status: "completed", processed_at: new Date().toISOString() } as never })
    .eq("id", itemId);

  return { ok: !error };
}

/**
 * Позначити як помилку.
 */
export async function failItem(
  itemId: string,
  error: string,
): Promise<{ ok: boolean }> {
  const { data: row } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", itemId)
    .single();

  const v = (row?.value ?? {}) as Record<string, unknown>;
  const { error: updateError } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: { ...v, status: "failed", error } as never })
    .eq("id", itemId);

  return { ok: !updateError };
}

/**
 * Отримати статистику черги.
 */
export async function getQueueStats(
  queue: string,
): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("fact_kind", "queue_item");

  const items = (data ?? []).filter((r) => ((r.value ?? {}) as Record<string, unknown>).queue === queue);

  const countByStatus = (status: string) =>
    items.filter((r) => ((r.value ?? {}) as Record<string, unknown>).status === status).length;

  return {
    pending: countByStatus("pending"),
    processing: countByStatus("processing"),
    completed: countByStatus("completed"),
    failed: countByStatus("failed"),
  };
}
