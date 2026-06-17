/**
 * Smart Data Sync — синхронізація даних між системами.
 *
 * Синхронізує:
 * 1. Shopify → MARQ (товари, замовлення, клієнти)
 * 2. WooCommerce → MARQ (аналогічно)
 * 3. MARQ → Email (клієнти для розсилок)
 * 4. MARQ → Telegram (сповіщення)
 *
 * Shopify/WooCommerce requires credentials stored in tenant_configs.features.shopify|woo.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SyncResult = {
  synced: number;
  errors: number;
  duration_ms: number;
};

type ShopifyProduct = {
  id: number;
  title: string;
  variants: Array<{ price: string; inventory_quantity: number }>;
};

type ShopifyOrder = {
  id: number;
  email: string;
  total_price: string;
  currency: string;
  financial_status: string;
  created_at: string;
};

async function getShopifyConfig(tenantId: string): Promise<{ shop: string; token: string } | null> {
  const { data } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const f = (data?.features as Record<string, unknown> | null) ?? {};
  const s = f.shopify as Record<string, string> | undefined;
  if (!s?.shop || !s.token) return null;
  return { shop: s.shop, token: s.token };
}

async function shopifyFetch<T>(shop: string, token: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://${shop}.myshopify.com/admin/api/2024-01${path}`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Синхронізувати товари з Shopify.
 */
export async function syncShopifyProducts(tenantId: string): Promise<SyncResult> {
  const start = Date.now();
  const creds = await getShopifyConfig(tenantId);
  if (!creds) return { synced: 0, errors: 0, duration_ms: Date.now() - start };

  const data = await shopifyFetch<{ products: ShopifyProduct[] }>(
    creds.shop, creds.token, "/products.json?limit=250",
  );
  if (!data?.products) return { synced: 0, errors: 1, duration_ms: Date.now() - start };

  let synced = 0, errors = 0;
  for (const p of data.products) {
    const variant = p.variants[0];
    if (!variant) continue;
    const { error } = await supabaseAdmin.from("products").upsert(
      {
        tenant_id: tenantId,
        name: p.title,
        price_cents: Math.round(parseFloat(variant.price) * 100),
        currency: "UAH",
        stock: variant.inventory_quantity ?? 0,
        is_active: true,
        metadata: { shopify_id: p.id } as never,
      },
      { onConflict: "tenant_id,metadata->shopify_id" },
    );
    if (error) errors++; else synced++;
  }

  return { synced, errors, duration_ms: Date.now() - start };
}

/**
 * Синхронізувати замовлення з Shopify.
 */
export async function syncShopifyOrders(tenantId: string): Promise<SyncResult> {
  const start = Date.now();
  const creds = await getShopifyConfig(tenantId);
  if (!creds) return { synced: 0, errors: 0, duration_ms: Date.now() - start };

  const data = await shopifyFetch<{ orders: ShopifyOrder[] }>(
    creds.shop, creds.token, "/orders.json?limit=250&status=any",
  );
  if (!data?.orders) return { synced: 0, errors: 1, duration_ms: Date.now() - start };

  let synced = 0, errors = 0;
  for (const o of data.orders) {
    const status = o.financial_status === "paid" ? "paid" : "pending";
    const { error } = await supabaseAdmin.from("orders").upsert(
      {
        tenant_id: tenantId,
        customer_email: o.email,
        total_cents: Math.round(parseFloat(o.total_price) * 100),
        currency: o.currency,
        status,
        created_at: o.created_at,
        metadata: { shopify_id: o.id } as never,
      },
      { onConflict: "tenant_id,metadata->shopify_id" },
    );
    if (error) errors++; else synced++;
  }

  return { synced, errors, duration_ms: Date.now() - start };
}

/**
 * Синхронізувати клієнтів з Shopify.
 */
export async function syncShopifyCustomers(tenantId: string): Promise<SyncResult> {
  const start = Date.now();
  const creds = await getShopifyConfig(tenantId);
  if (!creds) return { synced: 0, errors: 0, duration_ms: Date.now() - start };

  type ShopifyCustomer = { id: number; email: string; first_name: string; last_name: string; orders_count: number; total_spent: string };
  const data = await shopifyFetch<{ customers: ShopifyCustomer[] }>(
    creds.shop, creds.token, "/customers.json?limit=250",
  );
  if (!data?.customers) return { synced: 0, errors: 1, duration_ms: Date.now() - start };

  let synced = 0, errors = 0;
  for (const c of data.customers) {
    const { error } = await supabaseAdmin.from("customers").upsert(
      {
        tenant_id: tenantId,
        email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
        total_orders: c.orders_count,
        total_spent_cents: Math.round(parseFloat(c.total_spent) * 100),
        metadata: { shopify_id: c.id } as never,
      },
      { onConflict: "tenant_id,email" },
    );
    if (error) errors++; else synced++;
  }

  return { synced, errors, duration_ms: Date.now() - start };
}

/**
 * Отримати статус синхронізації.
 */
export async function getSyncStatus(
  tenantId: string,
): Promise<Array<{
  source: string;
  last_sync: string;
  status: "ok" | "error" | "pending";
  items_synced: number;
}>> {
  const { data: integrations } = await supabaseAdmin
    .from("tenant_integrations")
    .select("provider, last_sync_at, last_sync_status, synced_orders_count")
    .eq("tenant_id", tenantId);

  return (integrations ?? []).map((i) => ({
    source: i.provider,
    last_sync: i.last_sync_at ?? "",
    status: (i.last_sync_status as "ok" | "error" | "pending") ?? "pending",
    items_synced: i.synced_orders_count ?? 0,
  }));
}
