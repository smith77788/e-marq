/**
 * Smart Automation System — централізована система автоматизації.
 *
 * Автоматизації зберігаються в bootstrap_facts (fact_kind: "automation").
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Automation = {
  id: string;
  tenant_id: string;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
  last_run?: string;
  next_run?: string;
  run_count: number;
};

function rowToAutomation(row: { fact_key: string | null; tenant_id: string | null; value: unknown }): Automation {
  const v = (row.value ?? {}) as Record<string, unknown>;
  return {
    id: row.fact_key ?? "",
    tenant_id: row.tenant_id ?? "",
    name: (v.name as string) ?? "",
    trigger: (v.trigger as string) ?? "",
    action: (v.action as string) ?? "",
    enabled: (v.enabled as boolean) ?? false,
    last_run: (v.last_run as string) ?? undefined,
    next_run: (v.next_run as string) ?? undefined,
    run_count: (v.run_count as number) ?? 0,
  };
}

/**
 * Отримати автоматизації тенанта.
 */
export async function getAutomations(
  tenantId: string,
): Promise<Automation[]> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("fact_key, tenant_id, value")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "automation")
    .order("created_at", { ascending: false });

  return (data ?? []).map(rowToAutomation);
}

/**
 * Створити автоматизацію.
 */
export async function createAutomation(
  tenantId: string,
  name: string,
  trigger: string,
  action: string,
): Promise<{ ok: boolean; id?: string }> {
  const id = `automation:${tenantId}:${Date.now()}`;

  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: id,
      fact_kind: "automation",
      tenant_id: tenantId,
      value: { name, trigger, action, enabled: true, run_count: 0 } as never,
    });

  if (error) return { ok: false };
  return { ok: true, id };
}

/**
 * Увімкнути/вимкнути автоматизацію.
 */
export async function toggleAutomation(
  automationId: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("fact_key", automationId)
    .maybeSingle();

  if (!existing) return { ok: false };

  const updated = { ...(existing.value as Record<string, unknown>), enabled };

  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: updated as never })
    .eq("fact_key", automationId);

  return { ok: !error };
}

/**
 * Виконати автоматизацію.
 */
export async function runAutomation(
  automationId: string,
): Promise<{ ok: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("fact_key", automationId)
    .maybeSingle();

  if (!existing) return { ok: false };

  const v = (existing.value ?? {}) as Record<string, unknown>;
  const updated = {
    ...v,
    last_run: new Date().toISOString(),
    run_count: ((v.run_count as number) ?? 0) + 1,
  };

  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: updated as never })
    .eq("fact_key", automationId);

  return { ok: !error };
}
