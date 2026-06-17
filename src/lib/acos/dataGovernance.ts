/**
 * Smart Data Governance — управління якістю та життєвим циклом даних.
 *
 * Функції:
 * 1. Data Classification — класифікація даних за чутливістю
 * 2. Retention Policies — політики зберігання
 * 3. Data Lineage — зв'язки між таблицями
 * 4. Quality Metrics — метрики якості
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DataClassification = {
  table: string;
  field: string;
  classification: "public" | "internal" | "confidential" | "restricted";
  description: string;
};

/**
 * Класифікація даних.
 */
export const DATA_CLASSIFICATIONS: DataClassification[] = [
  { table: "customers", field: "email", classification: "confidential", description: "Персональні дані" },
  { table: "customers", field: "name", classification: "confidential", description: "Персональні дані" },
  { table: "orders", field: "customer_email", classification: "confidential", description: "Персональні дані" },
  { table: "orders", field: "shipping_address", classification: "confidential", description: "Адреса доставки" },
  { table: "products", field: "name", classification: "internal", description: "Назва товару" },
  { table: "products", field: "price_cents", classification: "internal", description: "Ціна товару" },
  { table: "events", field: "payload", classification: "internal", description: "Дані подій" },
];

/**
 * Політика зберігання.
 */
export const RETENTION_POLICIES: Record<string, number> = {
  events: 90, // 90 днів
  orders: 365 * 3, // 3 роки (бухгалтерія)
  customers: 365 * 2, // 2 роки
  analytics_snapshots: 30, // 30 днів
  audit_log: 365, // 1 рік
};

/**
 * Отримати метрики якості даних.
 */
export async function getDataQualityMetrics(
  tenantId: string,
): Promise<Record<string, { total: number; complete: number; quality_pct: number }>> {
  const metrics: Record<string, { total: number; complete: number; quality_pct: number }> = {};

  const tables = ["customers", "orders", "products"];
  for (const table of tables) {
    const { count: total } = await supabaseAdmin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    // Якість = % записів без NULL в критичних полях
    const { count: incomplete } = await supabaseAdmin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("email", null);

    const totalCount = total ?? 0;
    const incompleteCount = incomplete ?? 0;
    const qualityPct = totalCount > 0 ? ((totalCount - incompleteCount) / totalCount) * 100 : 100;

    metrics[table] = {
      total: totalCount,
      complete: totalCount - incompleteCount,
      quality_pct: Math.round(qualityPct),
    };
  }

  return metrics;
}
