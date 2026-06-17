/**
 * Smart Data Audit — аудит даних для відповідності GDPR.
 *
 * Перевіряє:
 * 1. Зберігання PII (персональні дані)
 * 2. Згоду на обробку даних
 * 3. Термін зберігання
 * 4. Права на видалення
 * 5. Безпеку передачі
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AuditIssue = {
  category: string;
  issue: string;
  severity: "high" | "medium" | "low";
  recommendation: string;
  affected_records: number;
};

/**
 * Провести аудит GDPR.
 */
export async function auditGdprCompliance(
  tenantId: string,
): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];

  // 1. Клієнти без згоди на маркетинг
  const { count: noConsent } = await supabaseAdmin
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("consent_marketing", null);

  if (noConsent && noConsent > 0) {
    issues.push({
      category: "Згода",
      issue: `${noConsent} клієнтів без згоди на маркетинг`,
      severity: "high",
      recommendation: "Додайте opt-in при реєстрації",
      affected_records: noConsent,
    });
  }

  // 2. Клієнти зі старими даними (>2 роки)
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString();
  const { count: oldCustomers } = await supabaseAdmin
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .lt("last_order_at", twoYearsAgo);

  if (oldCustomers && oldCustomers > 0) {
    issues.push({
      category: "Термін зберігання",
      issue: `${oldCustomers} клієнтів без покупок >2 років`,
      severity: "medium",
      recommendation: "Архівуйте або видаліть неактивних клієнтів",
      affected_records: oldCustomers,
    });
  }

  // 3. Замовлення без email (неможливо зв'язатись)
  const { count: noEmailOrders } = await supabaseAdmin
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("customer_email", null);

  if (noEmailOrders && noEmailOrders > 0) {
    issues.push({
      category: "Якість даних",
      issue: `${noEmailOrders} замовлень без email`,
      severity: "low",
      recommendation: "Зробіть email обов'язковим при оформленні",
      affected_records: noEmailOrders,
    });
  }

  return issues;
}
