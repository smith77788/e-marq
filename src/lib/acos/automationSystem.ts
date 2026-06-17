/**
 * Smart Automation System — централізована система автоматизації.
 *
 * Автоматизації:
 * 1. Email campaigns — розсилки
 * 2. Social media posts — публікації
 * 3. Inventory alerts — сповіщення про запаси
 * 4. Price adjustments — зміна цін
 * 5. Customer follow-up — листування з клієнтами
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

/**
 * Отримати автоматизації тенанта.
 */
export async function getAutomations(
  tenantId: string,
): Promise<Automation[]> {
  const { data } = await supabaseAdmin
    .from("automations")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Automation[];
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
  const { data, error } = await supabaseAdmin
    .from("automations")
    .insert({
      tenant_id: tenantId,
      name,
      trigger,
      action,
      enabled: true,
      run_count: 0,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Увімкнути/вимкнути автоматизацію.
 */
export async function toggleAutomation(
  automationId: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("automations")
    .update({ enabled })
    .eq("id", automationId);

  return { ok: !error };
}

/**
 * Виконати автоматизацію.
 */
export async function runAutomation(
  automationId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("automations")
    .update({
      last_run: new Date().toISOString(),
      run_count: supabaseAdmin.rpc("increment", { x: 1 }),
    })
    .eq("id", automationId);

  return { ok: !error };
}
