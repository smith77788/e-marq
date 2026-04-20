import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SB = SupabaseClient<Database>;

type EventType = Database["public"]["Enums"]["event_type"];

const DEMO_PRODUCTS = [
  {
    name: "Premium Hoodie",
    sku: "HOODIE-PREM-001",
    price_cents: 5900,
    stock: 50,
    description: "Heavyweight cotton-blend hoodie with brushed interior.",
    image_url: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600",
  },
  {
    name: "Classic T-Shirt",
    sku: "TEE-CLASSIC-001",
    price_cents: 2400,
    stock: 200,
    description: "Soft 100% cotton tee, regular fit.",
    image_url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600",
  },
  {
    name: "Sneakers Pro",
    sku: "SNEAK-PRO-001",
    price_cents: 12900,
    stock: 30,
    description: "Performance running sneakers with cushioned sole.",
    image_url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600",
  },
  {
    name: "Baseball Cap",
    sku: "CAP-BB-001",
    price_cents: 1900,
    stock: 100,
    description: "Adjustable cotton cap with embroidered logo.",
    image_url: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=600",
  },
  {
    name: "Canvas Tote Bag",
    sku: "TOTE-CAN-001",
    price_cents: 1500,
    stock: 75,
    description: "Durable canvas tote, perfect for daily use.",
    image_url: "https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600",
  },
  {
    name: "Leather Wallet",
    sku: "WALLET-LTH-001",
    price_cents: 4500,
    stock: 40,
    description: "Genuine leather bifold wallet with RFID protection.",
    image_url: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=600",
  },
  {
    name: "Wireless Earbuds",
    sku: "AUDIO-EB-001",
    price_cents: 8900,
    stock: 60,
    description: "Bluetooth 5.3 earbuds with active noise cancellation.",
    image_url: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600",
  },
  {
    name: "Water Bottle",
    sku: "BTL-H2O-001",
    price_cents: 1200,
    stock: 150,
    description: "Insulated stainless steel bottle, 750ml.",
    image_url: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600",
  },
];

const FIRST_NAMES = ["Anna", "Bob", "Carlos", "Diana", "Erik", "Fatima", "Gabriel", "Hana", "Ivan", "Julia", "Karim", "Lena"];
const LAST_NAMES = ["Smith", "Johnson", "Garcia", "Müller", "Kowalski", "Rossi", "Chen", "Patel", "Silva", "Novak"];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomTimestamp(): string {
  // Weight: 60% in last 7 days, 40% spread across days 8-30
  const now = Date.now();
  const daysAgo = Math.random() < 0.6 ? randomInt(0, 7) : randomInt(8, 30);
  const ts = now - daysAgo * 24 * 60 * 60 * 1000 - randomInt(0, 24 * 60 * 60 * 1000);
  return new Date(ts).toISOString();
}

function randomEmail(): string {
  const first = randomChoice(FIRST_NAMES).toLowerCase();
  const last = randomChoice(LAST_NAMES).toLowerCase();
  return `${first}.${last}${randomInt(1, 99)}@example.com`;
}

function randomName(): string {
  return `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`;
}

function uuid(): string {
  return crypto.randomUUID();
}

export async function generateDemoProducts(tenantId: string, supabase: SB): Promise<string[]> {
  const rows = DEMO_PRODUCTS.map((p) => ({
    tenant_id: tenantId,
    name: p.name,
    sku: p.sku,
    price_cents: p.price_cents,
    currency: "USD",
    stock: p.stock,
    description: p.description,
    image_url: p.image_url,
    is_active: true,
  }));
  const { data, error } = await supabase.from("products").insert(rows).select("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

export async function generateDemoOrders(
  tenantId: string,
  productIds: string[],
  productPriceMap: Map<string, { name: string; price_cents: number }>,
  count: number,
  supabase: SB,
): Promise<{ orderId: string; created_at: string }[]> {
  const orderRows = Array.from({ length: count }).map(() => {
    const itemCount = randomInt(1, 3);
    const picks = Array.from({ length: itemCount }).map(() => {
      const pid = randomChoice(productIds);
      const meta = productPriceMap.get(pid)!;
      const qty = randomInt(1, 2);
      return { pid, qty, name: meta.name, price: meta.price_cents };
    });
    const total = picks.reduce((sum, x) => sum + x.qty * x.price, 0);
    const created_at = randomTimestamp();
    return {
      tenant_id: tenantId,
      currency: "USD",
      status: "paid" as const,
      total_cents: total,
      customer_email: randomEmail(),
      customer_name: randomName(),
      created_at,
      updated_at: created_at,
      metadata: { source: "demo", picks: picks.map((p) => ({ pid: p.pid, qty: p.qty })) },
    };
  });

  const { data: orders, error } = await supabase
    .from("orders")
    .insert(orderRows)
    .select("id, created_at, metadata");
  if (error) throw error;

  const itemRows: Database["public"]["Tables"]["order_items"]["Insert"][] = [];
  for (const o of orders ?? []) {
    const meta = o.metadata as { picks?: { pid: string; qty: number }[] };
    for (const p of meta.picks ?? []) {
      const pmeta = productPriceMap.get(p.pid)!;
      itemRows.push({
        order_id: o.id,
        tenant_id: tenantId,
        product_id: p.pid,
        product_name: pmeta.name,
        quantity: p.qty,
        unit_price_cents: pmeta.price_cents,
      });
    }
  }
  if (itemRows.length > 0) {
    const { error: itemErr } = await supabase.from("order_items").insert(itemRows);
    if (itemErr) throw itemErr;
  }

  return (orders ?? []).map((o) => ({ orderId: o.id, created_at: o.created_at }));
}

export async function generateDemoEvents(
  tenantId: string,
  productIds: string[],
  orderIds: string[],
  sessionCount: number,
  supabase: SB,
): Promise<number> {
  const events: Database["public"]["Tables"]["events"]["Insert"][] = [];

  for (let i = 0; i < sessionCount; i++) {
    const sessionId = uuid();
    const sessionStart = randomTimestamp();
    const baseMs = new Date(sessionStart).getTime();
    let step = 0;
    const nextTs = () => {
      step += randomInt(10, 120);
      return new Date(baseMs + step * 1000).toISOString();
    };

    // 100% page_view → mapped to content_viewed
    events.push({
      tenant_id: tenantId,
      type: "content_viewed" as EventType,
      session_id: sessionId,
      payload: { ts: nextTs(), path: "/" },
    });

    // 70% product_viewed
    if (Math.random() < 0.7) {
      const pid = randomChoice(productIds);
      events.push({
        tenant_id: tenantId,
        type: "product_viewed" as EventType,
        session_id: sessionId,
        product_id: pid,
        payload: { ts: nextTs() },
      });

      // 50% add_to_cart
      if (Math.random() < 0.5) {
        events.push({
          tenant_id: tenantId,
          type: "add_to_cart" as EventType,
          session_id: sessionId,
          product_id: pid,
          payload: { ts: nextTs(), quantity: randomInt(1, 2) },
        });

        // 50% checkout_started
        if (Math.random() < 0.5) {
          events.push({
            tenant_id: tenantId,
            type: "checkout_started" as EventType,
            session_id: sessionId,
            product_id: pid,
            payload: { ts: nextTs() },
          });

          // 55% purchase_completed (linked to a real order if available)
          if (Math.random() < 0.55 && orderIds.length > 0) {
            events.push({
              tenant_id: tenantId,
              type: "purchase_completed" as EventType,
              session_id: sessionId,
              product_id: pid,
              order_id: randomChoice(orderIds),
              payload: { ts: nextTs() },
            });
          }
        }
      }
    }
  }

  // Insert in chunks of 500 to be safe
  const chunkSize = 500;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);
    const { error } = await supabase.from("events").insert(chunk);
    if (error) throw error;
  }
  return events.length;
}

export async function clearDemoData(tenantId: string, supabase: SB): Promise<void> {
  // Order matters due to FKs: events → order_items → orders → products
  const { error: e1 } = await supabase.from("events").delete().eq("tenant_id", tenantId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("order_items").delete().eq("tenant_id", tenantId);
  if (e2) throw e2;
  const { error: e3 } = await supabase.from("orders").delete().eq("tenant_id", tenantId);
  if (e3) throw e3;
  const { error: e4 } = await supabase.from("products").delete().eq("tenant_id", tenantId);
  if (e4) throw e4;
}

export const DEMO_PRODUCT_COUNT = DEMO_PRODUCTS.length;
export { DEMO_PRODUCTS };
