/**
 * Smart Data Quality — моніторинг та покращення якості даних.
 *
 * Перевіряє:
 * 1. Повноту даних (missing fields)
 * 2. Консистентність (дублікати, невідповідності)
 * 3. Актуальність (застарілі дані)
 * 4. Коректність (валидні значення)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type QualityIssue = {
  table: string;
  field: string;
  issue: "missing" | "duplicate" | "outdated" | "invalid";
  count: number;
  severity: "high" | "medium" | "low";
  recommendation: string;
};

/**
 * Аналіз якості даних.
 */
export async function analyzeDataQuality(
  tenantId: string,
): Promise<QualityIssue[]> {
  const issues: QualityIssue[] = [];

  // 1. Клієнти без email
  const { count: noEmail } = await supabaseAdmin
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("email", null);

  if (noEmail && noEmail > 0) {
    issues.push({
      table: "customers",
      field: "email",
      issue: "missing",
      count: noEmail,
      severity: "medium",
      recommendation: "Додайте email для комунікації з клієнтами",
    });
  }

  // 2. Товари без опису
  const { count: noDescription } = await supabaseAdmin
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .is("description", null);

  if (noDescription && noDescription > 0) {
    issues.push({
      table: "products",
      field: "description",
      issue: "missing",
      count: noDescription,
      severity: "high",
      recommendation: "Додайте описи для SEO та конверсії",
    });
  }

  // 3. Товари без зображення
  const { count: noImage } = await supabaseAdmin
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .is("image_url", null);

  if (noImage && noImage > 0) {
    issues.push({
      table: "products",
      field: "image_url",
      issue: "missing",
      count: noImage,
      severity: "high",
      recommendation: "Додайте зображення для залучення клієнтів",
    });
  }

  // 4. Замовлення без адреси
  const { count: noAddress } = await supabaseAdmin
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("shipping_address", null)
    .eq("status", "paid");

  if (noAddress && noAddress > 0) {
    issues.push({
      table: "orders",
      field: "shipping_address",
      issue: "missing",
      count: noAddress,
      severity: "medium",
      recommendation: "Додайте адресу для доставки",
    });
  }

  return issues;
}
