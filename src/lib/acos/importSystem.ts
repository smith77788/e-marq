/**
 * Smart Import System — централізована система імпорту даних.
 *
 * Джерела:
 * 1. CSV — ручний імпорт
 * 2. Shopify — OAuth імпорт
 * 3. WooCommerce — API імпорт
 * 4. Google Sheets — публічний URL
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import Papa from "papaparse";

/**
 * Імпорт CSV файлу.
 */
export async function importCsv(
  tenantId: string,
  csvContent: string,
  entityType: "products" | "customers" | "orders",
): Promise<{ imported: number; errors: number }> {
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
  const rows = parsed.data as Record<string, string>[];

  let imported = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      switch (entityType) {
        case "products":
          await supabaseAdmin.from("products").insert({
            tenant_id: tenantId,
            name: row.name || row.Name || "",
            price_cents: Math.round(parseFloat(row.price || row.Price || "0") * 100),
            stock: parseInt(row.stock || row.Stock || "0"),
            is_active: true,
          });
          break;
        case "customers":
          await supabaseAdmin.from("customers").insert({
            tenant_id: tenantId,
            email: row.email || row.Email || "",
            name: row.name || row.Name || "",
            total_orders: 0,
            total_spent_cents: 0,
          });
          break;
      }
      imported++;
    } catch {
      errors++;
    }
  }

  return { imported, errors };
}

/**
 * Валідувати CSV перед імпортом.
 */
export function validateCsv(
  csvContent: string,
  requiredFields: string[],
): { valid: boolean; errors: string[] } {
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];

  const errors: string[] = [];
  for (const field of requiredFields) {
    if (!headers.includes(field)) {
      errors.push(`Відсутнє обов'язкове поле: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
