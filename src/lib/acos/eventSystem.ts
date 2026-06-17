/**
 * Smart Event System — централізована система подій.
 *
 * Типи подій:
 * 1. Business Events — бізнес-події (замовлення, клієнти)
 * 2. System Events — системні події (помилки, запуски)
 * 3. User Events — події користувачів (вхід, дії)
 * 4. Agent Events — події агентів (інсайти, дії)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Event = {
  id: string;
  tenant_id: string;
  type: string;
  payload: unknown;
  created_at: string;
};

/**
 * Записати подію.
 */
export async function trackEvent(
  tenantId: string,
  type: string,
  _category: "business" | "system" | "user" | "agent",
  payload: unknown,
  _source: string,
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .insert({
      tenant_id: tenantId,
      type: type as never,
      payload: payload as never,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Отримати події тенанта.
 */
export async function getEvents(
  tenantId: string,
  options?: {
    category?: string;
    type?: string;
    limit?: number;
    since?: string;
  },
): Promise<Event[]> {
  let query = supabaseAdmin
    .from("events")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.type) {
    query = query.eq("type", options.type as never);
  }
  if (options?.since) {
    query = query.gte("created_at", options.since);
  }

  const { data } = await query;
  return (data ?? []) as Event[];
}

/**
 * Отримати статистику подій.
 */
export async function getEventStats(
  tenantId: string,
  days: number = 7,
): Promise<Record<string, number>> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from("events")
    .select("type")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .limit(10000);

  const stats: Record<string, number> = {};
  for (const e of data ?? []) {
    stats[e.type] = (stats[e.type] ?? 0) + 1;
  }

  return stats;
}
