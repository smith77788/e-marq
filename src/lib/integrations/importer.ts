/**
 * Сервіс імпорту: бере parsedRows + mapping → пише в products/customers/orders.
 * Створює запис в import_jobs з результатом.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { parsePriceToCents, type EntityKind, type ParsedRow } from "./parser";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
type OrderInsert = Database["public"]["Tables"]["orders"]["Insert"];

export type ImportInput = {
  tenantId: string;
  sourceProvider: string;
  sourceKind?: "manual" | "scheduled" | "webhook";
  entityKind: EntityKind;
  rows: ParsedRow[];
  mapping: Record<string, string>;
  integrationId?: string;
  userId?: string;
};

export type ImportResult = {
  jobId: string;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
};

export async function runImport(input: ImportInput): Promise<ImportResult> {
  const { tenantId, sourceProvider, entityKind, rows, mapping, integrationId, userId } = input;

  // 1) Створюємо job
  const { data: job, error: jobErr } = await supabase
    .from("import_jobs")
    .insert({
      tenant_id: tenantId,
      integration_id: integrationId ?? null,
      source_provider: sourceProvider,
      source_kind: input.sourceKind ?? "manual",
      entity_kind: entityKind,
      status: "running",
      rows_total: rows.length,
      created_by: userId ?? null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    throw new Error(jobErr?.message ?? "Не вдалось створити запис імпорту");
  }

  const errors: Array<{ row: number; message: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  const get = (row: ParsedRow, canonical: string): string => {
    const col = mapping[canonical];
    if (!col) return "";
    const val = row[col];
    return val == null ? "" : String(val).trim();
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      if (entityKind === "products") {
        const name = get(row, "name");
        if (!name) {
          skipped++;
          continue;
        }
        const payload: ProductInsert = {
          tenant_id: tenantId,
          name,
          sku: get(row, "sku") || null,
          price_cents: parsePriceToCents(get(row, "price_cents")),
          stock: parseInt(get(row, "stock") || "0", 10) || 0,
          description: get(row, "description") || null,
          image_url: get(row, "image_url") || null,
          currency: (get(row, "currency") || "UAH").toUpperCase().slice(0, 3),
          is_active: true,
          metadata: { import_source: sourceProvider, import_job_id: job.id },
        };
        const { error } = await supabase.from("products").insert(payload);
        if (error) {
          failed++;
          errors.push({ row: i + 2, message: error.message });
        } else {
          imported++;
        }
      } else if (entityKind === "customers") {
        const name = get(row, "name");
        if (!name) {
          skipped++;
          continue;
        }
        const payload: CustomerInsert = {
          tenant_id: tenantId,
          name,
          email: get(row, "email").toLowerCase() || null,
          telegram_username: get(row, "telegram_username") || null,
          metadata: {
            phone: get(row, "phone") || null,
            import_source: sourceProvider,
            import_job_id: job.id,
          },
        };
        const { error } = await supabase.from("customers").insert(payload);
        if (error) {
          failed++;
          errors.push({ row: i + 2, message: error.message });
        } else {
          imported++;
        }
      } else if (entityKind === "orders") {
        const customerName = get(row, "customer_name");
        const totalCents = parsePriceToCents(get(row, "total_cents"));
        if (!customerName || !totalCents) {
          skipped++;
          continue;
        }
        // Маппінг популярних статусів з різних систем у наш enum
        // (pending | paid | fulfilled | cancelled | refunded)
        const rawStatus = (get(row, "status") || "pending").toLowerCase().trim();
        type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
        const statusMap: Record<string, OrderStatus> = {
          pending: "pending", new: "pending", processing: "pending", "оплата очікується": "pending",
          paid: "paid", оплачено: "paid", complete: "paid",
          shipped: "fulfilled", completed: "fulfilled", fulfilled: "fulfilled", delivered: "fulfilled", доставлено: "fulfilled",
          cancelled: "cancelled", canceled: "cancelled", скасовано: "cancelled",
          refunded: "refunded", повернено: "refunded",
        };
        const finalStatus: OrderStatus = statusMap[rawStatus] ?? "pending";
        // payment_method обмежений тригером БД до 'stripe_card' | 'manual'
        const rawPm = get(row, "payment_method").toLowerCase();
        const paymentMethod = rawPm === "stripe_card" || rawPm === "stripe" ? "stripe_card" : "manual";
        const orderPayload: OrderInsert = {
          tenant_id: tenantId,
          customer_name: customerName,
          customer_email: get(row, "customer_email").toLowerCase() || null,
          total_cents: totalCents,
          currency: (get(row, "currency") || "UAH").toUpperCase().slice(0, 3),
          status: finalStatus,
          payment_method: paymentMethod,
          paid_at: finalStatus === "paid" ? new Date().toISOString() : null,
          metadata: {
            external_id: get(row, "external_id") || null,
            import_source: sourceProvider,
            import_job_id: job.id,
          },
        };
        const { error } = await supabase.from("orders").insert(orderPayload);
        if (error) {
          failed++;
          errors.push({ row: i + 2, message: error.message });
        } else {
          imported++;
        }
      }
    } catch (e) {
      failed++;
      errors.push({ row: i + 2, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // 2) Закриваємо job
  await supabase
    .from("import_jobs")
    .update({
      status: failed > 0 ? "completed_with_errors" : "completed",
      rows_imported: imported,
      rows_skipped: skipped,
      rows_failed: failed,
      error_summary: errors.slice(0, 50),
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  return { jobId: job.id, total: rows.length, imported, skipped, failed, errors };
}
