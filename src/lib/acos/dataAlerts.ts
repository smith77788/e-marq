/**
 * Smart Data Alerts — автоматичні сповіщення про зміни в даних.
 *
 * Типи сповіщень:
 * 1. Spike — різке зростання
 * 2. Drop — різке падіння
 * 3. Anomaly — аномалія
 * 4. Threshold — досягнення порогу
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DataAlert = {
  id: string;
  type: "spike" | "drop" | "anomaly" | "threshold";
  metric: string;
  value: number;
  threshold?: number;
  message: string;
  severity: "high" | "medium" | "low";
  created_at: string;
};

/**
 * Перевірити аномалії в даних.
 */
export async function checkDataAnomalies(
  tenantId: string,
): Promise<DataAlert[]> {
  const alerts: DataAlert[] = [];

  // Перевірити продажі за останню годину vs середнє за тиждень
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [recent, weekly] = await Promise.all([
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", hourAgo),
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", weekAgo),
  ]);

  const recentTotal = (recent.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const weeklyTotal = (weekly.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const avgHourly = weeklyTotal / (7 * 24);

  if (avgHourly > 0) {
    const change = (recentTotal - avgHourly) / avgHourly;

    if (change > 1) {
      alerts.push({
        id: `spike-${Date.now()}`,
        type: "spike",
        metric: "Виручка",
        value: recentTotal,
        threshold: avgHourly,
        message: `Виручка зросла на ${Math.round(change * 100)}% за годину`,
        severity: "high",
        created_at: new Date().toISOString(),
      });
    } else if (change < -0.5) {
      alerts.push({
        id: `drop-${Date.now()}`,
        type: "drop",
        metric: "Виручка",
        value: recentTotal,
        threshold: avgHourly,
        message: `Виручка впала на ${Math.round(Math.abs(change) * 100)}% за годину`,
        severity: "critical",
        created_at: new Date().toISOString(),
      });
    }
  }

  return alerts;
}
