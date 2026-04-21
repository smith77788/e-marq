/**
 * ACOS-rich synthetic dataset generator (90 days)
 *
 * Builds realistic D2C commerce data so ACOS agents (churn risk, stockout,
 * AOV leak, pricing elasticity, search gaps) have real signals to find.
 *
 * Key shape vs the simple demo:
 * - 16 SKUs across 4 categories with affinity (hoodie+tee, sneakers+cap…)
 * - 250 customers split into cohorts:
 *     • new (no purchase yet, bot/visit only)         ~30%
 *     • one-time (1 order, recent or old)              ~25%
 *     • returning (2-4 orders, healthy cadence)        ~25%
 *     • VIP-active (5+ orders, recent)                 ~10%
 *     • VIP-churning (5+ orders, recency drift > 1.5x) ~10% ← real churn signal
 * - Daily order intensity: weekly seasonality (weekend bump), monthly trend
 * - Stockout risk on 2 SKUs (fast-moving, low stock)
 * - Search-no-results events on 1 missing category (real SEO gap)
 * - AOV leak: ~20% of carts abandoned after add_to_cart
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SB = SupabaseClient<Database>;
type EventType = Database["public"]["Enums"]["event_type"];

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

type CatalogProduct = {
  name: string;
  sku: string;
  price_cents: number;
  stock: number;
  category: "apparel" | "footwear" | "accessories" | "audio";
  description: string;
  image_url: string;
};

const CATALOG: CatalogProduct[] = [
  // Apparel
  { name: "Premium Hoodie", sku: "HOODIE-PREM-001", price_cents: 5900, stock: 50, category: "apparel", description: "Heavyweight cotton-blend hoodie.", image_url: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600" },
  { name: "Classic T-Shirt", sku: "TEE-CLASSIC-001", price_cents: 2400, stock: 200, category: "apparel", description: "Soft 100% cotton tee.", image_url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600" },
  { name: "Zip Hoodie Lite", sku: "HOODIE-LITE-002", price_cents: 4900, stock: 60, category: "apparel", description: "Lightweight zip-up hoodie.", image_url: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=600" },
  { name: "Long Sleeve Tee", sku: "TEE-LS-002", price_cents: 2900, stock: 120, category: "apparel", description: "Soft long-sleeve cotton tee.", image_url: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=600" },
  // Footwear (stockout risk on Sneakers Pro)
  { name: "Sneakers Pro", sku: "SNEAK-PRO-001", price_cents: 12900, stock: 12, category: "footwear", description: "Performance running sneakers.", image_url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600" },
  { name: "Sneakers Lite", sku: "SNEAK-LITE-002", price_cents: 8900, stock: 40, category: "footwear", description: "Everyday casual sneakers.", image_url: "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=600" },
  { name: "Trail Boots", sku: "BOOT-TRAIL-001", price_cents: 15900, stock: 25, category: "footwear", description: "Waterproof trail boots.", image_url: "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=600" },
  // Accessories (Baseball Cap = stockout risk)
  { name: "Baseball Cap", sku: "CAP-BB-001", price_cents: 1900, stock: 8, category: "accessories", description: "Adjustable embroidered cap.", image_url: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=600" },
  { name: "Canvas Tote Bag", sku: "TOTE-CAN-001", price_cents: 1500, stock: 75, category: "accessories", description: "Durable canvas tote.", image_url: "https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600" },
  { name: "Leather Wallet", sku: "WALLET-LTH-001", price_cents: 4500, stock: 40, category: "accessories", description: "Bifold wallet, RFID-protected.", image_url: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=600" },
  { name: "Beanie Knit", sku: "BEANIE-KNT-001", price_cents: 1800, stock: 90, category: "accessories", description: "Soft knit beanie.", image_url: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600" },
  { name: "Crew Socks 3-Pack", sku: "SOCK-CREW-003", price_cents: 1200, stock: 200, category: "accessories", description: "Cushioned crew socks, pack of 3.", image_url: "https://images.unsplash.com/photo-1586350977771-2a1dba1c2b6c?w=600" },
  // Audio
  { name: "Wireless Earbuds", sku: "AUDIO-EB-001", price_cents: 8900, stock: 60, category: "audio", description: "Bluetooth 5.3 earbuds, ANC.", image_url: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600" },
  { name: "Over-Ear Headphones", sku: "AUDIO-OE-002", price_cents: 16900, stock: 30, category: "audio", description: "Studio-grade over-ear headphones.", image_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600" },
  { name: "Portable Speaker", sku: "AUDIO-SPK-003", price_cents: 7900, stock: 45, category: "audio", description: "Waterproof portable speaker.", image_url: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=600" },
  { name: "Water Bottle", sku: "BTL-H2O-001", price_cents: 1200, stock: 150, category: "accessories", description: "Insulated 750ml stainless bottle.", image_url: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600" },
];

// Affinity pairs — when one is bought, the other often goes in the cart
const AFFINITY: Record<string, string[]> = {
  "HOODIE-PREM-001": ["TEE-CLASSIC-001", "BEANIE-KNT-001"],
  "HOODIE-LITE-002": ["TEE-LS-002", "CAP-BB-001"],
  "SNEAK-PRO-001": ["SOCK-CREW-003", "CAP-BB-001"],
  "SNEAK-LITE-002": ["SOCK-CREW-003"],
  "AUDIO-EB-001": ["AUDIO-SPK-003"],
  "AUDIO-OE-002": ["AUDIO-EB-001"],
};

// Search terms — last one ("smart watch") has zero results (SEO gap signal)
const SEARCH_TERMS_HIT = ["hoodie", "sneakers", "tee", "earbuds", "cap", "wallet", "speaker"];
const SEARCH_TERMS_MISS = ["smart watch", "fitness tracker", "running shorts"];

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const FIRST_NAMES = ["Anna", "Bob", "Carlos", "Diana", "Erik", "Fatima", "Gabriel", "Hana", "Ivan", "Julia", "Karim", "Lena", "Marco", "Nadia", "Oscar", "Petra", "Quinn", "Rosa", "Sami", "Tara"];
const LAST_NAMES = ["Smith", "Johnson", "Garcia", "Müller", "Kowalski", "Rossi", "Chen", "Patel", "Silva", "Novak", "Andersen", "Dubois", "Yamada"];

type Cohort = "new" | "one_time" | "returning" | "vip_active" | "vip_churning";

type Customer = {
  id: string; // synthetic, not in DB
  email: string;
  name: string;
  cohort: Cohort;
  sessionId: string;
};

// ---------------------------------------------------------------------------
// Random helpers (seeded-ish via Math.random)
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function uuid() {
  return crypto.randomUUID();
}

function isoDaysAgo(days: number, hourJitter = true): string {
  const now = Date.now();
  const ms = now - days * 24 * 60 * 60 * 1000 - (hourJitter ? randInt(0, 86400) * 1000 : 0);
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Cohort generation
// ---------------------------------------------------------------------------

function generateCustomers(total: number): Customer[] {
  const list: Customer[] = [];
  const dist: { cohort: Cohort; weight: number }[] = [
    { cohort: "new", weight: 0.30 },
    { cohort: "one_time", weight: 0.25 },
    { cohort: "returning", weight: 0.25 },
    { cohort: "vip_active", weight: 0.10 },
    { cohort: "vip_churning", weight: 0.10 },
  ];
  for (let i = 0; i < total; i++) {
    const r = Math.random();
    let acc = 0;
    let cohort: Cohort = "new";
    for (const d of dist) {
      acc += d.weight;
      if (r <= acc) { cohort = d.cohort; break; }
    }
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    list.push({
      id: uuid(),
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
      name: `${first} ${last}`,
      cohort,
      sessionId: uuid(),
    });
  }
  return list;
}

// Weekly seasonality multiplier (Sat/Sun ~1.4x, Tue/Wed dip)
function dayOfWeekFactor(date: Date): number {
  const d = date.getDay(); // 0 Sun .. 6 Sat
  if (d === 0 || d === 6) return 1.4;
  if (d === 5) return 1.2;
  if (d === 2 || d === 3) return 0.85;
  return 1.0;
}

// Monthly trend: gentle growth across 90 days + a small spike around day -30
function trendFactor(daysAgo: number): number {
  const growth = 1 + (90 - daysAgo) * 0.004; // +0.4% per day forward
  const spike = daysAgo > 28 && daysAgo < 35 ? 1.35 : 1.0; // ~payday spike
  return growth * spike;
}

// ---------------------------------------------------------------------------
// Step 1: Insert products and return id+meta map
// ---------------------------------------------------------------------------

export async function generateAcosProducts(
  tenantId: string,
  supabase: SB,
): Promise<Map<string, { id: string; name: string; price_cents: number; sku: string; category: string }>> {
  const rows = CATALOG.map((p) => ({
    tenant_id: tenantId,
    name: p.name,
    sku: p.sku,
    price_cents: p.price_cents,
    currency: "UAH",
    stock: p.stock,
    description: p.description,
    image_url: p.image_url,
    is_active: true,
  }));
  const { data, error } = await supabase.from("products").insert(rows).select("id, sku, name, price_cents");
  if (error) throw error;

  const bySku = new Map<string, { id: string; name: string; price_cents: number; sku: string; category: string }>();
  for (const row of data ?? []) {
    const cat = CATALOG.find((c) => c.sku === row.sku)?.category ?? "accessories";
    bySku.set(row.sku!, { id: row.id, name: row.name, price_cents: row.price_cents, sku: row.sku!, category: cat });
  }
  return bySku;
}

// ---------------------------------------------------------------------------
// Step 2: Build orders for the 90-day window, distributed by cohort behavior
// ---------------------------------------------------------------------------

type ProductMeta = { id: string; name: string; price_cents: number; sku: string; category: string };

type OrderPlan = {
  customer: Customer;
  daysAgo: number;
  items: { product: ProductMeta; qty: number }[];
};

function buildCart(productsBySku: Map<string, ProductMeta>, anchorSku?: string): { product: ProductMeta; qty: number }[] {
  const skus = Array.from(productsBySku.keys());
  const anchor = anchorSku && productsBySku.has(anchorSku) ? anchorSku : pick(skus);
  const cart: { product: ProductMeta; qty: number }[] = [
    { product: productsBySku.get(anchor)!, qty: randInt(1, 2) },
  ];
  // 60% chance to add an affinity product
  const affs = AFFINITY[anchor] ?? [];
  if (affs.length > 0 && Math.random() < 0.6) {
    const partnerSku = pick(affs);
    if (productsBySku.has(partnerSku)) {
      cart.push({ product: productsBySku.get(partnerSku)!, qty: 1 });
    }
  }
  // 20% chance to add a third random item
  if (Math.random() < 0.2) {
    const extra = pick(skus.filter((s) => !cart.some((c) => c.product.sku === s)));
    if (extra) cart.push({ product: productsBySku.get(extra)!, qty: 1 });
  }
  return cart;
}

function planOrdersForCustomer(c: Customer, productsBySku: Map<string, ProductMeta>): OrderPlan[] {
  const plans: OrderPlan[] = [];
  switch (c.cohort) {
    case "new":
      // No orders — visit only
      break;
    case "one_time": {
      const daysAgo = randInt(5, 80);
      plans.push({ customer: c, daysAgo, items: buildCart(productsBySku) });
      break;
    }
    case "returning": {
      const count = randInt(2, 4);
      // Spread 60-80 day window, healthy cadence
      const span = randInt(60, 80);
      for (let i = 0; i < count; i++) {
        const daysAgo = Math.round((span / count) * i + randInt(2, 8));
        plans.push({ customer: c, daysAgo, items: buildCart(productsBySku) });
      }
      break;
    }
    case "vip_active": {
      const count = randInt(5, 8);
      // Recent activity within 60 days
      for (let i = 0; i < count; i++) {
        const daysAgo = Math.round(((60 / count) * i) + randInt(1, 5));
        plans.push({ customer: c, daysAgo, items: buildCart(productsBySku) });
      }
      break;
    }
    case "vip_churning": {
      // 5+ orders BUT all > 35 days ago → recency > 1.5× their avg interval
      const count = randInt(5, 7);
      // Concentrated in days 40-85 ago, nothing recent
      for (let i = 0; i < count; i++) {
        const daysAgo = randInt(40, 85);
        plans.push({ customer: c, daysAgo, items: buildCart(productsBySku) });
      }
      break;
    }
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Step 3: Insert orders + order_items
// ---------------------------------------------------------------------------

export async function insertAcosOrders(
  tenantId: string,
  customers: Customer[],
  productsBySku: Map<string, ProductMeta>,
  supabase: SB,
): Promise<{ orderId: string; createdAt: string; customer: Customer; items: { product: ProductMeta; qty: number }[] }[]> {
  const allPlans: OrderPlan[] = [];
  for (const c of customers) {
    allPlans.push(...planOrdersForCustomer(c, productsBySku));
  }

  // Apply seasonality + trend to actual timestamp jitter
  const orderRows = allPlans.map((plan) => {
    const baseDate = new Date(Date.now() - plan.daysAgo * 24 * 60 * 60 * 1000 - randInt(0, 86400) * 1000);
    const total = plan.items.reduce((s, it) => s + it.product.price_cents * it.qty, 0);
    return {
      tenant_id: tenantId,
      currency: "UAH",
      status: "paid" as const,
      total_cents: total,
      customer_email: plan.customer.email,
      customer_name: plan.customer.name,
      created_at: baseDate.toISOString(),
      updated_at: baseDate.toISOString(),
      paid_at: baseDate.toISOString(),
      metadata: {
        source: "acos_synth",
        cohort: plan.customer.cohort,
        synth_customer_id: plan.customer.id,
        items: plan.items.map((it) => ({ sku: it.product.sku, qty: it.qty })),
      },
    };
  });

  if (orderRows.length === 0) return [];

  // Insert in chunks (RLS does not block this for tenant members; payload limit ~1MB)
  const inserted: { id: string; created_at: string; metadata: unknown }[] = [];
  const chunkSize = 200;
  for (let i = 0; i < orderRows.length; i += chunkSize) {
    const chunk = orderRows.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("orders")
      .insert(chunk)
      .select("id, created_at, metadata");
    if (error) throw error;
    inserted.push(...(data ?? []));
  }

  // Build order_items rows from metadata
  const itemRows: Database["public"]["Tables"]["order_items"]["Insert"][] = [];
  const planByCustomerAndDay = new Map<string, OrderPlan>();
  for (const p of allPlans) {
    planByCustomerAndDay.set(`${p.customer.id}|${p.daysAgo}`, p);
  }

  type OrderMeta = { synth_customer_id?: string; items?: { sku: string; qty: number }[]; cohort?: Cohort };
  const result: { orderId: string; createdAt: string; customer: Customer; items: { product: ProductMeta; qty: number }[] }[] = [];

  for (const order of inserted) {
    const meta = order.metadata as OrderMeta;
    const cust = customers.find((c) => c.id === meta.synth_customer_id);
    const items: { product: ProductMeta; qty: number }[] = [];
    for (const it of meta.items ?? []) {
      const prod = productsBySku.get(it.sku);
      if (!prod) continue;
      items.push({ product: prod, qty: it.qty });
      itemRows.push({
        order_id: order.id,
        tenant_id: tenantId,
        product_id: prod.id,
        product_name: prod.name,
        quantity: it.qty,
        unit_price_cents: prod.price_cents,
      });
    }
    if (cust) {
      result.push({ orderId: order.id, createdAt: order.created_at, customer: cust, items });
    }
  }

  // Insert items
  for (let i = 0; i < itemRows.length; i += 500) {
    const chunk = itemRows.slice(i, i + 500);
    const { error } = await supabase.from("order_items").insert(chunk);
    if (error) throw error;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 4: Generate events with realistic funnel + search-no-results signals
// ---------------------------------------------------------------------------

export async function insertAcosEvents(
  tenantId: string,
  customers: Customer[],
  productsBySku: Map<string, ProductMeta>,
  ordersInserted: { orderId: string; createdAt: string; customer: Customer; items: { product: ProductMeta; qty: number }[] }[],
  supabase: SB,
): Promise<number> {
  const events: Database["public"]["Tables"]["events"]["Insert"][] = [];
  const productSkus = Array.from(productsBySku.keys());

  // 1) Visit sessions for ALL customers — multiple sessions for active ones
  for (const c of customers) {
    const sessionsCount = c.cohort === "new" ? randInt(1, 3)
      : c.cohort === "vip_active" ? randInt(8, 14)
      : c.cohort === "vip_churning" ? randInt(1, 2)
      : c.cohort === "returning" ? randInt(3, 6)
      : randInt(1, 3);

    for (let s = 0; s < sessionsCount; s++) {
      const sessionId = uuid();
      const daysAgo = c.cohort === "vip_churning" ? randInt(40, 89) : randInt(0, 89);
      const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - randInt(0, 86400) * 1000);
      const factor = dayOfWeekFactor(date) * trendFactor(daysAgo);

      // page_view (mapped to content_viewed)
      events.push({
        tenant_id: tenantId,
        type: "content_viewed" as EventType,
        session_id: sessionId,
        payload: { ts: date.toISOString(), path: "/", cohort: c.cohort },
        created_at: date.toISOString(),
      });

      // 30% chance of a search event during the session
      if (Math.random() < 0.30 * factor) {
        const isMiss = Math.random() < 0.18; // ~18% of searches are misses
        const term = isMiss ? pick(SEARCH_TERMS_MISS) : pick(SEARCH_TERMS_HIT);
        const searchTs = new Date(date.getTime() + randInt(5, 30) * 1000);
        events.push({
          tenant_id: tenantId,
          type: "content_viewed" as EventType,
          session_id: sessionId,
          payload: {
            ts: searchTs.toISOString(),
            path: "/search",
            search_term: term,
            results_count: isMiss ? 0 : randInt(1, 8),
          },
          created_at: searchTs.toISOString(),
        });
      }

      // 70% product_viewed
      if (Math.random() < 0.7) {
        const sku = pick(productSkus);
        const prod = productsBySku.get(sku)!;
        const ts = new Date(date.getTime() + randInt(20, 90) * 1000);
        events.push({
          tenant_id: tenantId,
          type: "product_viewed" as EventType,
          session_id: sessionId,
          product_id: prod.id,
          payload: { ts: ts.toISOString(), sku },
          created_at: ts.toISOString(),
        });

        // 45% add_to_cart
        if (Math.random() < 0.45) {
          const cartTs = new Date(ts.getTime() + randInt(15, 60) * 1000);
          events.push({
            tenant_id: tenantId,
            type: "add_to_cart" as EventType,
            session_id: sessionId,
            product_id: prod.id,
            payload: { ts: cartTs.toISOString(), sku, quantity: randInt(1, 2) },
            created_at: cartTs.toISOString(),
          });

          // 50% checkout_started
          if (Math.random() < 0.5) {
            const checkoutTs = new Date(cartTs.getTime() + randInt(20, 90) * 1000);
            events.push({
              tenant_id: tenantId,
              type: "checkout_started" as EventType,
              session_id: sessionId,
              product_id: prod.id,
              payload: { ts: checkoutTs.toISOString(), sku },
              created_at: checkoutTs.toISOString(),
            });
            // Note: purchase_completed events are emitted in step 2 below
            // (linked to real orders so funnel matches reality)
          }
          // else: cart abandoned → AOV leak signal
        }
      }
    }
  }

  // 2) Purchase events linked to real orders
  for (const o of ordersInserted) {
    const ts = new Date(o.createdAt);
    for (const it of o.items) {
      events.push({
        tenant_id: tenantId,
        type: "purchase_completed" as EventType,
        session_id: o.customer.sessionId,
        product_id: it.product.id,
        order_id: o.orderId,
        payload: { ts: ts.toISOString(), sku: it.product.sku, qty: it.qty, cohort: o.customer.cohort },
        created_at: ts.toISOString(),
      });
    }
  }

  // Insert in chunks
  const chunkSize = 500;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);
    const { error } = await supabase.from("events").insert(chunk);
    if (error) throw error;
  }
  return events.length;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export type AcosScale = "small" | "medium" | "large";

export type AcosGenerationResult = {
  products: number;
  customers: number;
  orders: number;
  events: number;
  cohorts: Record<Cohort, number>;
};

export async function generateAcosDataset(
  tenantId: string,
  scale: AcosScale,
  supabase: SB,
): Promise<AcosGenerationResult> {
  const customerCount = scale === "small" ? 120 : scale === "medium" ? 250 : 600;

  const productsBySku = await generateAcosProducts(tenantId, supabase);
  const customers = generateCustomers(customerCount);
  const orders = await insertAcosOrders(tenantId, customers, productsBySku, supabase);
  const events = await insertAcosEvents(tenantId, customers, productsBySku, orders, supabase);

  const cohorts: Record<Cohort, number> = {
    new: 0, one_time: 0, returning: 0, vip_active: 0, vip_churning: 0,
  };
  for (const c of customers) cohorts[c.cohort]++;

  return {
    products: productsBySku.size,
    customers: customers.length,
    orders: orders.length,
    events,
    cohorts,
  };
}

export const ACOS_CATALOG_SIZE = CATALOG.length;
