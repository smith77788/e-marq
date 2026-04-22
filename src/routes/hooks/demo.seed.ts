/**
 * Demo seed hook — super-admin only.
 *
 * Backfills a tenant with 90 days of realistic activity:
 *  - 8 sample products (if catalogue empty)
 *  - 25 customers with varied lifecycle stages
 *  - 60-120 paid orders distributed over 90d (so reorder cycles trigger)
 *  - product_viewed + add_to_cart + checkout_started + purchase_completed events
 *  - Some abandoned carts (checkout without purchase)
 *  - Some inactive customers (last order >60 days ago) for winback
 *
 * Idempotent-ish: only seeds products if catalogue empty; appends customers/orders.
 * Body: { tenant_id, force?: boolean }
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import type { Database } from "@/integrations/supabase/types";

async function isAuthorized(token: string): Promise<{ ok: boolean; userId?: string }> {
  if (!token) return { ok: false };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false };
  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data } = await sb.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (!userId) return { ok: false };
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin");
  return { ok: (roles ?? []).length > 0, userId };
}

const SAMPLE_PRODUCTS = [
  { name: "Cold-Brew Coffee Concentrate 1L", price_cents: 75000, stock: 80, sku: "CB-1L" },
  { name: "Single Origin Beans 250g", price_cents: 58000, stock: 120, sku: "SO-250" },
  { name: "Espresso Blend 500g", price_cents: 92000, stock: 60, sku: "ES-500" },
  { name: "Decaf Beans 250g", price_cents: 62000, stock: 40, sku: "DC-250" },
  { name: "Drip Bag Box (10 pcs)", price_cents: 50000, stock: 200, sku: "DB-10" },
  { name: "Reusable Filter", price_cents: 38000, stock: 30, sku: "FT-01" },
  { name: "Branded Mug", price_cents: 70000, stock: 25, sku: "MG-01" },
  { name: "Subscription Bag — Monthly", price_cents: 105000, stock: 999, sku: "SUB-M" },
];

const FIRST_NAMES = [
  "Anna",
  "Maria",
  "Olena",
  "Petro",
  "Ivan",
  "Yuri",
  "Sofia",
  "Kateryna",
  "Andriy",
  "Oksana",
  "Vitalii",
  "Nataliya",
  "Roman",
  "Yulia",
  "Bohdan",
  "Lesia",
  "Mykhailo",
  "Tetiana",
  "Serhii",
  "Daria",
];
const LAST_NAMES = [
  "Shevchenko",
  "Kovalenko",
  "Boyko",
  "Tkachenko",
  "Bondar",
  "Melnyk",
  "Kravchuk",
  "Marchenko",
  "Ostapenko",
  "Lysenko",
];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 24 * 3600 * 1000);
}

export const Route = createFileRoute("/hooks/demo/seed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        const auth = await isAuthorized(token);
        if (!auth.ok) return jsonError("Forbidden — super_admin only", 403);

        let tenantId: string | null = null;
        let force = false;
        try {
          const body = (await request.json()) as { tenant_id?: string; force?: boolean };
          tenantId = body.tenant_id ?? null;
          force = body.force ?? false;
        } catch {
          return jsonError("Invalid JSON", 400);
        }
        if (!tenantId) return jsonError("tenant_id required", 400);

        const log: string[] = [];

        // 1. Seed products if empty
        const { data: existing } = await supabaseAdmin
          .from("products")
          .select("id, name")
          .eq("tenant_id", tenantId);
        let productIds: { id: string; name: string; price_cents: number }[];
        if ((existing ?? []).length === 0 || force) {
          if (force && existing && existing.length > 0) {
            log.push(`Skipping product re-seed (force=true ignored — would orphan orders).`);
            productIds = existing.map((e) => ({ id: e.id, name: e.name, price_cents: 1500 }));
          } else {
            const rows = SAMPLE_PRODUCTS.map((p) => ({
              tenant_id: tenantId!,
              ...p,
              currency: "UAH",
              is_active: true,
            }));
            const { data: inserted, error } = await supabaseAdmin
              .from("products")
              .insert(rows)
              .select("id, name, price_cents");
            if (error) return jsonError("Failed to seed products", 500, { details: error.message });
            productIds = inserted ?? [];
            log.push(`Seeded ${productIds.length} products.`);
          }
        } else {
          const { data: full } = await supabaseAdmin
            .from("products")
            .select("id, name, price_cents")
            .eq("tenant_id", tenantId);
          productIds = full ?? [];
          log.push(`Re-using ${productIds.length} existing products.`);
        }
        if (productIds.length === 0) return jsonError("No products available", 500);

        // 2. Generate customer cohort
        const COHORT_SIZE = 25;
        const customers: Array<{
          email: string;
          name: string;
          phaseDay: number;
          cycleDays: number;
          orderCount: number;
        }> = [];
        for (let i = 0; i < COHORT_SIZE; i++) {
          const fn = rand(FIRST_NAMES);
          const ln = rand(LAST_NAMES);
          customers.push({
            email: `${fn.toLowerCase()}.${ln.toLowerCase()}.${i}@demo.local`,
            name: `${fn} ${ln}`,
            phaseDay: randInt(0, 89), // when they first appeared in 90d window
            cycleDays: randInt(14, 35),
            orderCount: randInt(1, 6),
          });
        }

        // 3. Create orders (paid) over the 90-day window
        let ordersCreated = 0;
        let eventsCreated = 0;
        for (const c of customers) {
          for (let n = 0; n < c.orderCount; n++) {
            const orderDay = c.phaseDay - n * c.cycleDays;
            if (orderDay < 0 || orderDay > 89) continue;
            const orderTs = daysAgo(orderDay);

            const item1 = rand(productIds);
            const item2 = Math.random() > 0.5 ? rand(productIds) : null;
            const items = [item1, item2].filter(Boolean) as {
              id: string;
              name: string;
              price_cents: number;
            }[];
            const total = items.reduce((s, p) => s + p.price_cents, 0);

            const { data: order, error: oErr } = await supabaseAdmin
              .from("orders")
              .insert({
                tenant_id: tenantId,
                customer_email: c.email,
                customer_name: c.name,
                status: "paid",
                total_cents: total,
                currency: "UAH",
                payment_method: "manual",
                created_at: orderTs.toISOString(),
                paid_at: orderTs.toISOString(),
              })
              .select("id")
              .single();
            if (oErr || !order) continue;

            await supabaseAdmin.from("order_items").insert(
              items.map((p) => ({
                tenant_id: tenantId!,
                order_id: order.id,
                product_id: p.id,
                product_name: p.name,
                quantity: 1,
                unit_price_cents: p.price_cents,
                created_at: orderTs.toISOString(),
              })),
            );
            ordersCreated++;

            // Funnel events around the order
            await supabaseAdmin.from("events").insert([
              {
                tenant_id: tenantId,
                type: "product_viewed",
                product_id: item1.id,
                payload: { email: c.email } as never,
                created_at: new Date(orderTs.getTime() - 3600 * 1000).toISOString(),
              },
              {
                tenant_id: tenantId,
                type: "add_to_cart",
                product_id: item1.id,
                payload: { email: c.email } as never,
                created_at: new Date(orderTs.getTime() - 1800 * 1000).toISOString(),
              },
              {
                tenant_id: tenantId,
                type: "checkout_started",
                payload: {
                  email: c.email,
                  cart_value_cents: total,
                  product_names: items.map((p) => p.name),
                } as never,
                session_id: `sess_${order.id}`,
                created_at: new Date(orderTs.getTime() - 600 * 1000).toISOString(),
              },
              {
                tenant_id: tenantId,
                type: "purchase_completed",
                order_id: order.id,
                payload: { email: c.email } as never,
                session_id: `sess_${order.id}`,
                created_at: orderTs.toISOString(),
              },
            ]);
            eventsCreated += 4;
          }
        }
        log.push(`Created ${ordersCreated} orders, ${eventsCreated} funnel events.`);

        // 4. Some "view-only" traffic (high views, low conversion → triggers AOV agent)
        for (let i = 0; i < 80; i++) {
          const p = rand(productIds);
          await supabaseAdmin.from("events").insert({
            tenant_id: tenantId,
            type: "product_viewed",
            product_id: p.id,
            payload: { source: "demo_traffic" } as never,
            created_at: daysAgo(randInt(0, 29)).toISOString(),
          });
        }

        // 5. Abandoned carts (checkout_started without purchase) — last 12h
        for (let i = 0; i < 4; i++) {
          const c = rand(customers);
          const p = rand(productIds);
          await supabaseAdmin.from("events").insert({
            tenant_id: tenantId,
            type: "checkout_started",
            payload: {
              email: c.email,
              cart_value_cents: p.price_cents,
              product_names: [p.name],
            } as never,
            session_id: `abandon_${i}_${Date.now()}`,
            created_at: new Date(Date.now() - randInt(2, 12) * 3600 * 1000).toISOString(),
          });
        }
        log.push(`Created 4 abandoned cart sessions.`);

        return jsonOk({
          ok: true,
          log,
          products: productIds.length,
          customers: customers.length,
          orders: ordersCreated,
        });
      },
    },
  },
});
