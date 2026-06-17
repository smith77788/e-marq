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
    .from("queue")
    .insert({
      queue,
      payload,
      status: "pending",
      attempts: 0,
      max_attempts: options?.maxAttempts ?? 3,
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
    .from("queue")
    .select("*")
    .eq("queue", queue)
    .eq("status", "pending")
    .lt("attempts", 3)
    .order("created_at")
    .limit(1)
    .single();

  if (!data) return null;

  // Позначити як processing
  await supabaseAdmin
    .from("queue")
    .update({ status: "processing", attempts: data.attempts + 1 })
    .eq("id", data.id);

  return data as QueueItem;
}

/**
 * Позначити як виконане.
 */
export async function completeItem(
  itemId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("queue")
    .update({ status: "completed", processed_at: new Date().toISOString() })
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
  const { error: updateError } = await supabaseAdmin
    .from("queue")
    .update({ status: "failed", error })
    .eq("id", itemId);

  return { ok: !updateError };
}

/**
 * Отримати статистику черги.
 */
export async function getQueueStats(
  queue: string,
): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
  const [pending, processing, completed, failed] = await Promise.all([
    supabaseAdmin.from("queue").select("*", { count: "exact", head: true }).eq("queue", queue).eq("status", "pending"),
    supabaseAdmin.from("queue").select("*", { count: "exact", head: true }).eq("queue", queue).eq("status", "processing"),
    supabaseAdmin.from("queue").select("*", { count: "exact", head: true }).eq("queue", queue).eq("status", "completed"),
    supabaseAdmin.from("queue").select("*", { count: "exact", head: true }).eq("queue", queue).eq("status", "failed"),
  ]);

  return {
    pending: pending.count ?? 0,
    processing: processing.count ?? 0,
    completed: completed.count ?? 0,
    failed: failed.count ?? 0,
  };
}
