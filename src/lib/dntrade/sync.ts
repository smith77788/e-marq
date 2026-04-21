/**
 * DN Trade → our DB sync.
 *
 * Strategy:
 *  - Products: upsert into `products` keyed by metadata.dntrade_id (fall back to sku).
 *  - Customers (Partners): upsert into `customers` by metadata.dntrade_id (fall back to email).
 *  - Orders: insert if metadata.dntrade_id not yet present (orders are immutable from our side).
 *
 * Pricing: DN Trade returns prices as decimal strings/numbers in UAH (тіло без копійок,
 * напр. "199.50"). Ми зберігаємо в копійках (`price_cents` / `unit_price_cents` / `total_cents`).
 *
 * Idempotency: every run is safe to re-run. We cap pages per run to avoid runaway loops
 * (max 50 pages = 5000 products / 5000 partners / 2500 orders per run — достатньо для будь-якого
 * cron tick; повна перша синхронізація просто триватиме кілька запусків).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  type DnOrder,
  type DnPartner,
  type DnProduct,
  listOrders,
  listPartners,
  listProducts,
  unwrapList,
} from "./client";

type SB = SupabaseClient<Database>;

const PAGE_CAP = 50;

function priceToCents(p: unknown): number {
  if (p == null) return 0;
  const n = typeof p === "number" ? p : parseFloat(String(p).replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export type SyncSummary = {
  products: { fetched: number; upserted: number };
  customers: { fetched: number; upserted: number };
  orders: { fetched: number; inserted: number; skipped: number };
  errors: string[];
};

export async function syncDnTradeProducts(
  sb: SB,
  tenantId: string,
  apiKey: string,
  modifiedFromIso?: string,
): Promise<SyncSummary["products"]> {
  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  const limit = 100;

  for (let page = 0; page < PAGE_CAP; page++) {
    const resp = await listProducts(apiKey, {
      limit,
      offset,
      modified_from: modifiedFromIso ? toDnDate(modifiedFromIso) : undefined,
    });
    const items = unwrapList<DnProduct>(resp, "products");
    if (items.length === 0) break;
    fetched += items.length;

    // Look up existing rows by dntrade_id to decide insert/update
    const dnIds = items.map((p) => p.product_id).filter(Boolean);
    const { data: existing } = await sb
      .from("products")
      .select("id, metadata")
      .eq("tenant_id", tenantId)
      .filter("metadata->>dntrade_id", "in", `(${dnIds.map((x) => `"${x}"`).join(",")})`);

    const byDnId = new Map<string, string>();
    for (const row of existing ?? []) {
      const m = row.metadata as { dntrade_id?: string } | null;
      if (m?.dntrade_id) byDnId.set(m.dntrade_id, row.id);
    }

    for (const p of items) {
      const payload = {
        tenant_id: tenantId,
        sku: p.sku ?? (p.code != null ? String(p.code) : null),
        name: p.title || "Без назви",
        description: p.short_description ?? p.description ?? null,
        price_cents: priceToCents(p.price),
        currency: "UAH",
        image_url: p.image_path ?? p.images?.[0] ?? null,
        stock: Math.max(0, Math.floor(Number(p.balance ?? 0))),
        is_active: true,
        metadata: {
          dntrade_id: p.product_id,
          dntrade_code: p.code ?? null,
          dntrade_barcode: p.barcode ?? null,
          dntrade_unit: p.unit_title ?? null,
          dntrade_synced_at: new Date().toISOString(),
        } as never,
      };

      const existingId = byDnId.get(p.product_id);
      if (existingId) {
        const { error } = await sb.from("products").update(payload).eq("id", existingId);
        if (!error) upserted++;
      } else {
        const { error } = await sb.from("products").insert(payload);
        if (!error) upserted++;
      }
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return { fetched, upserted };
}

export async function syncDnTradeCustomers(
  sb: SB,
  tenantId: string,
  apiKey: string,
): Promise<SyncSummary["customers"]> {
  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  const limit = 100;

  for (let page = 0; page < PAGE_CAP; page++) {
    const resp = await listPartners(apiKey, { limit, offset });
    const items = unwrapList<DnPartner>(resp, "partners");
    if (items.length === 0) break;
    fetched += items.length;

    const dnIds = items.map((p) => p.external_id).filter(Boolean);
    const { data: existing } = await sb
      .from("customers")
      .select("id, metadata")
      .eq("tenant_id", tenantId)
      .filter("metadata->>dntrade_id", "in", `(${dnIds.map((x) => `"${x}"`).join(",")})`);

    const byDnId = new Map<string, string>();
    for (const row of existing ?? []) {
      const m = row.metadata as { dntrade_id?: string } | null;
      if (m?.dntrade_id) byDnId.set(m.dntrade_id, row.id);
    }

    for (const p of items) {
      const name = p.full_title || p.title || null;
      const email = p.email ? p.email.trim().toLowerCase() : null;

      const update = {
        name,
        email,
        metadata: {
          dntrade_id: p.external_id,
          dntrade_phone: p.phone_number ?? null,
          dntrade_address: p.address ?? null,
          dntrade_tin: p.tin ?? null,
          dntrade_synced_at: new Date().toISOString(),
        } as never,
      };

      const existingId = byDnId.get(p.external_id);
      if (existingId) {
        const { error } = await sb.from("customers").update(update).eq("id", existingId);
        if (!error) upserted++;
      } else {
        const { error } = await sb.from("customers").insert({ tenant_id: tenantId, ...update });
        if (!error) upserted++;
      }
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return { fetched, upserted };
}

export async function syncDnTradeOrders(
  sb: SB,
  tenantId: string,
  apiKey: string,
  modifiedFromIso?: string,
): Promise<SyncSummary["orders"]> {
  let offset = 0;
  let fetched = 0;
  let inserted = 0;
  let skipped = 0;
  const limit = 50;

  // Pre-fetch a customer-id index for client_external_id lookups (cheap).
  // We'll lazily extend it as we go.
  const clientCache = new Map<string, string>();
  async function findCustomerId(dnClientId: string | undefined): Promise<string | null> {
    if (!dnClientId) return null;
    if (clientCache.has(dnClientId)) return clientCache.get(dnClientId)!;
    const { data } = await sb
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .filter("metadata->>dntrade_id", "eq", dnClientId)
      .maybeSingle();
    if (data?.id) {
      clientCache.set(dnClientId, data.id);
      return data.id;
    }
    return null;
  }

  for (let page = 0; page < PAGE_CAP; page++) {
    const resp = await listOrders(apiKey, {
      limit,
      offset,
      modified_from: modifiedFromIso ? toDnDate(modifiedFromIso) : undefined,
    });
    const items = unwrapList<DnOrder>(resp, "orders");
    if (items.length === 0) break;
    fetched += items.length;

    const dnIds = items.map((o) => o.external_id).filter(Boolean);
    const { data: existing } = await sb
      .from("orders")
      .select("id, metadata")
      .eq("tenant_id", tenantId)
      .filter("metadata->>dntrade_id", "in", `(${dnIds.map((x) => `"${x}"`).join(",")})`);
    const taken = new Set<string>();
    for (const row of existing ?? []) {
      const m = row.metadata as { dntrade_id?: string } | null;
      if (m?.dntrade_id) taken.add(m.dntrade_id);
    }

    for (const o of items) {
      if (taken.has(o.external_id)) {
        skipped++;
        continue;
      }

      const cart = Array.isArray(o.cart) ? o.cart : [];
      const totalCents =
        priceToCents(o.amount ?? o.total) ||
        cart.reduce(
          (sum, it) => sum + priceToCents(it.price) * Math.max(1, Number(it.quantity ?? 1)),
          0,
        );
      const isPaid = Number(o.paid ?? 0) === 1;
      const customerId = await findCustomerId(o.client_external_id);

      const { data: orderRow, error: orderErr } = await sb
        .from("orders")
        .insert({
          tenant_id: tenantId,
          customer_name: o.personal_info?.name ?? null,
          customer_email: null,
          status: isPaid ? "paid" : "pending",
          total_cents: totalCents,
          currency: "UAH",
          payment_method: "manual",
          paid_at: isPaid && o.date ? new Date(o.date).toISOString() : null,
          metadata: {
            dntrade_id: o.external_id,
            dntrade_number: o.number ?? null,
            dntrade_status: o.status ?? null,
            dntrade_client_id: o.client_external_id ?? null,
            dntrade_synced_at: new Date().toISOString(),
            customer_id: customerId,
          } as never,
        })
        .select("id")
        .single();

      if (orderErr || !orderRow) continue;

      // Items
      if (cart.length > 0) {
        // Map dntrade product_ids to our product ids in bulk
        const cartDnIds = cart.map((c) => c.product_id).filter(Boolean) as string[];
        const productIdMap = new Map<string, string>();
        const productNameMap = new Map<string, string>();
        if (cartDnIds.length > 0) {
          const { data: prods } = await sb
            .from("products")
            .select("id, name, metadata")
            .eq("tenant_id", tenantId)
            .filter(
              "metadata->>dntrade_id",
              "in",
              `(${cartDnIds.map((x) => `"${x}"`).join(",")})`,
            );
          for (const p of prods ?? []) {
            const m = p.metadata as { dntrade_id?: string } | null;
            if (m?.dntrade_id) {
              productIdMap.set(m.dntrade_id, p.id);
              productNameMap.set(m.dntrade_id, p.name);
            }
          }
        }

        const itemRows = cart.map((c) => ({
          tenant_id: tenantId,
          order_id: orderRow.id,
          product_id: c.product_id ? productIdMap.get(c.product_id) ?? null : null,
          product_name:
            c.title ?? (c.product_id ? productNameMap.get(c.product_id) ?? "Item" : "Item"),
          quantity: Math.max(1, Math.floor(Number(c.quantity ?? 1))),
          unit_price_cents: priceToCents(c.price),
        }));
        if (itemRows.length > 0) {
          await sb.from("order_items").insert(itemRows);
        }
      }

      inserted++;
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return { fetched, inserted, skipped };
}

export async function runFullDnTradeSync(
  sb: SB,
  tenantId: string,
  apiKey: string,
  opts: { kinds?: Array<"products" | "customers" | "orders">; modifiedFromIso?: string } = {},
): Promise<SyncSummary> {
  const kinds = opts.kinds ?? ["products", "customers", "orders"];
  const summary: SyncSummary = {
    products: { fetched: 0, upserted: 0 },
    customers: { fetched: 0, upserted: 0 },
    orders: { fetched: 0, inserted: 0, skipped: 0 },
    errors: [],
  };

  if (kinds.includes("products")) {
    try {
      summary.products = await syncDnTradeProducts(sb, tenantId, apiKey, opts.modifiedFromIso);
    } catch (e) {
      summary.errors.push(`products: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (kinds.includes("customers")) {
    try {
      summary.customers = await syncDnTradeCustomers(sb, tenantId, apiKey);
    } catch (e) {
      summary.errors.push(`customers: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (kinds.includes("orders")) {
    try {
      summary.orders = await syncDnTradeOrders(sb, tenantId, apiKey, opts.modifiedFromIso);
    } catch (e) {
      summary.errors.push(`orders: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}

/** ISO → "YYYY-MM-DD HH:MM:SS" як хоче DN Trade. */
function toDnDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
