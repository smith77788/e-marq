/**
 * Smart Real-Time System — оновлення в реальному часі.
 *
 * Технології:
 * 1. Supabase Realtime — підписки на зміни
 * 2. Server-Sent Events — односторонній зв'язок
 * 3. Polling — періодичне оновлення
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  payload: Record<string, unknown>;
  timestamp: string;
};

/**
 * Підписатися на зміни таблиці (серверна частина).
 */
export async function subscribeToChanges(
  tenantId: string,
  table: string,
  callback: (event: RealtimeEvent) => void,
): Promise<{ unsubscribe: () => void }> {
  // Supabase Realtime підписка
  const channel = supabaseAdmin
    .channel(`${table}_changes`)
    .on(
      "postgres_changes" as never,
      {
        event: "*",
        schema: "public",
        table,
        filter: `tenant_id=eq.${tenantId}`,
      } as never,
      (payload: unknown) => {
        const event = payload as { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> };
        callback({
          type: event.eventType as RealtimeEvent["type"],
          table,
          payload: event.new ?? event.old ?? {},
          timestamp: new Date().toISOString(),
        });
      },
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabaseAdmin.removeChannel(channel);
    },
  };
}

/**
 * Polling для оновлень (fallback).
 */
export async function pollForChanges(
  tenantId: string,
  table: string,
  lastSeen: string,
): Promise<RealtimeEvent[]> {
  const { data } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("tenant_id", tenantId)
    .gte("updated_at", lastSeen)
    .order("updated_at");

  return (data ?? []).map((row) => ({
    type: "UPDATE" as const,
    table,
    payload: row,
    timestamp: (row as Record<string, unknown>).updated_at as string,
  }));
}
