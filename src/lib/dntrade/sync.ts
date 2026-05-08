/**
 * DN Trade → our DB sync.
 *
 * Підтримує два режими:
 *   - normal: пише в БД, повертає лічильники + per-record помилки.
 *   - dryRun: НЕ пише, повертає sample мапінгу (перші 5 записів кожного типу) + всі помилки.
 *
 * Per-record помилки логуються в `dntrade_sync_errors` (тільки в normal режимі).
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

const PAGE_CAP = 20;
const SAMPLE_LIMIT = 5;

function priceToCents(p: unknown): number {
  if (p == null) return 0;
  const n = typeof p === "number" ? p : parseFloat(String(p).replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export type MappingError = {
  kind: "products" | "customers" | "orders";
  external_id: string | null;
  message: string;
  raw?: unknown;
};

export type SyncSummary = {
  products: { fetched: number; upserted: number };
  customers: { fetched: number; upserted: number };
  orders: { fetched: number; inserted: number; skipped: number };
  errors: string[];
  mapping_errors: MappingError[];
  samples?: {
    products: unknown[];
    customers: unknown[];
    orders: unknown[];
  };
};

export type SyncOptions = {
  kinds?: Array<"products" | "customers" | "orders">;
  modifiedFromIso?: string;
  /** Hard caps keep first-run imports responsive in the onboarding UI. */
  maxPages?: number;
  requestTimeoutMs?: number;
  /** Якщо true — НЕ писати в БД, повернути sample мапінгу. */
  dryRun?: boolean;
  /** Інтеграція для прив'язки помилок у dntrade_sync_errors. */
  integrationId?: string;
};

function mapProduct(tenantId: string, p: DnProduct) {
  if (!p.product_id) throw new Error("missing product_id");
  if (!p.title) throw new Error("missing title");
  return {
    tenant_id: tenantId,
    sku: p.sku ?? (p.code != null ? String(p.code) : null),
    name: p.title,
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
}

function mapCustomer(tenantId: string, p: DnPartner) {
  if (!p.external_id) throw new Error("missing external_id");
  return {
    tenant_id: tenantId,
    name: p.full_title || p.title || null,
    email: p.email ? p.email.trim().toLowerCase() : null,
    metadata: {
      dntrade_id: p.external_id,
      dntrade_phone: p.phone_number ?? null,
      dntrade_address: p.address ?? null,
      dntrade_tin: p.tin ?? null,
      dntrade_synced_at: new Date().toISOString(),
    } as never,
  };
}

export async function syncDnTradeProducts(
  sb: SB,
  tenantId: string,
  apiKey: string,
  opts: SyncOptions,
  errors: MappingError[],
  samples: unknown[],
): Promise<SyncSummary["products"]> {
  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  const limit = 100;

  const pageCap = Math.min(opts.maxPages ?? PAGE_CAP, PAGE_CAP);
  for (let page = 0; page < pageCap; page++) {
    const resp = await listProducts(apiKey, {
      limit,
      offset,
      modified_from: opts.modifiedFromIso ? toDnDate(opts.modifiedFromIso) : undefined,
      timeoutMs: opts.requestTimeoutMs,
    });
    const items = unwrapList<DnProduct>(resp, "products");
    if (items.length === 0) break;
    fetched += items.length;

    const dnIds = items.map((p) => p.product_id).filter(Boolean);
    const byDnId = new Map<string, string>();
    if (!opts.dryRun && dnIds.length > 0) {
      const { data: existing } = await sb
        .from("products")
        .select("id, metadata")
        .eq("tenant_id", tenantId)
        .filter("metadata->>dntrade_id", "in", `(${dnIds.map((x) => `"${x}"`).join(",")})`);
      for (const row of existing ?? []) {
        const m = row.metadata as { dntrade_id?: string } | null;
        if (m?.dntrade_id) byDnId.set(m.dntrade_id, row.id);
      }
    }

    for (const p of items) {
      try {
        const payload = mapProduct(tenantId, p);
        if (samples.length < SAMPLE_LIMIT) samples.push(payload);
        if (opts.dryRun) {
          upserted++;
          continue;
        }
        const existingId = byDnId.get(p.product_id);
        const { error } = existingId
          ? await sb.from("products").update(payload).eq("id", existingId)
          : await sb.from("products").insert(payload);
        if (error) {
          errors.push({
            kind: "products",
            external_id: p.product_id,
            message: error.message,
            raw: p,
          });
        } else {
          upserted++;
        }
      } catch (e) {
        errors.push({
          kind: "products",
          external_id: p.product_id ?? null,
          message: e instanceof Error ? e.message : String(e),
          raw: p,
        });
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
  opts: SyncOptions,
  errors: MappingError[],
  samples: unknown[],
): Promise<SyncSummary["customers"]> {
  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  const limit = 100;

  const pageCap = Math.min(opts.maxPages ?? PAGE_CAP, PAGE_CAP);
  for (let page = 0; page < pageCap; page++) {
    const resp = await listPartners(apiKey, { limit, offset, timeoutMs: opts.requestTimeoutMs });
    const items = unwrapList<DnPartner>(resp, "partners");
    if (items.length === 0) break;
    fetched += items.length;

    const dnIds = items.map((p) => p.external_id).filter(Boolean);
    const byDnId = new Map<string, string>();
    if (!opts.dryRun && dnIds.length > 0) {
      const { data: existing } = await sb
        .from("customers")
        .select("id, metadata")
        .eq("tenant_id", tenantId)
        .filter("metadata->>dntrade_id", "in", `(${dnIds.map((x) => `"${x}"`).join(",")})`);
      for (const row of existing ?? []) {
        const m = row.metadata as { dntrade_id?: string } | null;
        if (m?.dntrade_id) byDnId.set(m.dntrade_id, row.id);
      }
    }

    for (const p of items) {
      try {
        const payload = mapCustomer(tenantId, p);
        if (samples.length < SAMPLE_LIMIT) samples.push(payload);
        if (opts.dryRun) {
          upserted++;
          continue;
        }
        const existingId = byDnId.get(p.external_id);
        const { error } = existingId
          ? await sb.from("customers").update(payload).eq("id", existingId)
          : await sb.from("customers").insert(payload);
        if (error) {
          errors.push({
            kind: "customers",
            external_id: p.external_id,
            message: error.message,
            raw: p,
          });
        } else {
          upserted++;
        }
      } catch (e) {
        errors.push({
          kind: "customers",
          external_id: p.external_id ?? null,
          message: e instanceof Error ? e.message : String(e),
          raw: p,
        });
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
  opts: SyncOptions,
  errors: MappingError[],
  samples: unknown[],
): Promise<SyncSummary["orders"]> {
  let offset = 0;
  let fetched = 0;
  let inserted = 0;
  let skipped = 0;
  const limit = 50;

  const clientCache = new Map<string, string>();
  async function findCustomerId(dnClientId: string | undefined): Promise<string | null> {
    if (!dnClientId) return null;
    if (clientCache.has(dnClientId)) return clientCache.get(dnClientId)!;
    if (opts.dryRun) return null;
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

  const pageCap = Math.min(opts.maxPages ?? PAGE_CAP, PAGE_CAP);
  for (let page = 0; page < pageCap; page++) {
    const resp = await listOrders(apiKey, {
      limit,
      offset,
      modified_from: opts.modifiedFromIso ? toDnDate(opts.modifiedFromIso) : undefined,
      timeoutMs: opts.requestTimeoutMs,
    });
    const items = unwrapList<DnOrder>(resp, "orders");
    if (items.length === 0) break;
    fetched += items.length;

    const taken = new Set<string>();
    if (!opts.dryRun) {
      const dnIds = items.map((o) => o.external_id).filter(Boolean);
      if (dnIds.length > 0) {
        const { data: existing } = await sb
          .from("orders")
          .select("id, metadata")
          .eq("tenant_id", tenantId)
          .filter("metadata->>dntrade_id", "in", `(${dnIds.map((x) => `"${x}"`).join(",")})`);
        for (const row of existing ?? []) {
          const m = row.metadata as { dntrade_id?: string } | null;
          if (m?.dntrade_id) taken.add(m.dntrade_id);
        }
      }
    }

    for (const o of items) {
      try {
        if (!o.external_id) throw new Error("missing external_id");
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

        const orderPayload = {
          tenant_id: tenantId,
          customer_name: o.personal_info?.name ?? null,
          customer_email: null as string | null,
          status: (isPaid ? "paid" : "pending") as Database["public"]["Enums"]["order_status"],
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
            items_preview: cart.slice(0, 3).map((c) => ({
              title: c.title,
              qty: c.quantity,
              price: c.price,
            })),
          } as never,
        };

        if (samples.length < SAMPLE_LIMIT) samples.push(orderPayload);

        if (opts.dryRun) {
          inserted++;
          continue;
        }

        const { data: orderRow, error: orderErr } = await sb
          .from("orders")
          .insert(orderPayload)
          .select("id")
          .single();

        if (orderErr || !orderRow) {
          errors.push({
            kind: "orders",
            external_id: o.external_id,
            message: orderErr?.message ?? "insert failed",
            raw: o,
          });
          continue;
        }

        if (cart.length > 0) {
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
            product_id: c.product_id ? (productIdMap.get(c.product_id) ?? null) : null,
            product_name:
              c.title ?? (c.product_id ? (productNameMap.get(c.product_id) ?? "Item") : "Item"),
            quantity: Math.max(1, Math.floor(Number(c.quantity ?? 1))),
            unit_price_cents: priceToCents(c.price),
          }));
          if (itemRows.length > 0) {
            const { error: itemsErr } = await sb.from("order_items").insert(itemRows);
            if (itemsErr) {
              errors.push({
                kind: "orders",
                external_id: o.external_id,
                message: `items: ${itemsErr.message}`,
                raw: { order: o.external_id, items_count: itemRows.length },
              });
            }
          }
        }
        inserted++;
      } catch (e) {
        errors.push({
          kind: "orders",
          external_id: o.external_id ?? null,
          message: e instanceof Error ? e.message : String(e),
          raw: o,
        });
      }
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
  opts: SyncOptions = {},
): Promise<SyncSummary> {
  const kinds = opts.kinds ?? ["products", "customers", "orders"];
  const mapping_errors: MappingError[] = [];
  const summary: SyncSummary = {
    products: { fetched: 0, upserted: 0 },
    customers: { fetched: 0, upserted: 0 },
    orders: { fetched: 0, inserted: 0, skipped: 0 },
    errors: [],
    mapping_errors,
  };

  const productSamples: unknown[] = [];
  const customerSamples: unknown[] = [];
  const orderSamples: unknown[] = [];

  if (kinds.includes("products")) {
    try {
      summary.products = await syncDnTradeProducts(
        sb,
        tenantId,
        apiKey,
        opts,
        mapping_errors,
        productSamples,
      );
    } catch (e) {
      summary.errors.push(`products: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (kinds.includes("customers")) {
    try {
      summary.customers = await syncDnTradeCustomers(
        sb,
        tenantId,
        apiKey,
        opts,
        mapping_errors,
        customerSamples,
      );
    } catch (e) {
      summary.errors.push(`customers: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (kinds.includes("orders")) {
    try {
      summary.orders = await syncDnTradeOrders(
        sb,
        tenantId,
        apiKey,
        opts,
        mapping_errors,
        orderSamples,
      );
    } catch (e) {
      summary.errors.push(`orders: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (opts.dryRun) {
    summary.samples = {
      products: productSamples,
      customers: customerSamples,
      orders: orderSamples,
    };
  } else if (opts.integrationId && mapping_errors.length > 0) {
    // Persist (best-effort) — keep last ~100 errors per integration to avoid bloat.
    await sb.from("dntrade_sync_errors").delete().eq("integration_id", opts.integrationId);
    const rows = mapping_errors.slice(0, 100).map((err) => ({
      tenant_id: tenantId,
      integration_id: opts.integrationId!,
      kind: err.kind,
      external_id: err.external_id,
      message: err.message,
      raw: (err.raw ?? {}) as never,
    }));
    if (rows.length > 0) await sb.from("dntrade_sync_errors").insert(rows);
  }

  return summary;
}

/** ISO → "YYYY-MM-DD HH:MM:SS" як хоче DN Trade. */
function toDnDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
