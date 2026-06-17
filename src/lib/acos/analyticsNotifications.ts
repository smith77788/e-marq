/**
 * Smart Analytics Notifications — сповіщення про аналітичні висновки.
 *
 * Автоматично надсилає сповіщення при:
 * 1. Важливому insight
 * 2. Аномалії
 * 3. Досягненні мети
 * 4. Проблемі
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Надіслати сповіщення про insight.
 */
export async function notifyInsight(
  tenantId: string,
  insightType: string,
  title: string,
  body: string,
): Promise<{ ok: boolean }> {
  // Записати в БД
  const { error } = await supabaseAdmin.from("owner_notifications").insert({
    tenant_id: tenantId,
    kind: "agent_insight",
    severity: insightType === "warning" ? "high" : "medium",
    title,
    body,
  });

  return { ok: !error };
}

/**
 * Надіслати сповіщення про досягнення мети.
 */
export async function notifyGoalAchieved(
  tenantId: string,
  goal: string,
  value: number,
): Promise<{ ok: boolean }> {
  return notifyInsight(
    tenantId,
    "opportunity",
    "Мету досягнуто!",
    `${goal}: ${value}`,
  );
}

/**
 * Надіслати сповіщення про проблему.
 */
export async function notifyProblem(
  tenantId: string,
  problem: string,
  impact: string,
): Promise<{ ok: boolean }> {
  return notifyInsight(
    tenantId,
    "warning",
    "Потребує уваги",
    `${problem}. ${impact}`,
  );
}
