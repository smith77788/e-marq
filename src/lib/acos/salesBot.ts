/**
 * Sales Bot — autonomous dialogue closing.
 *
 * Reads recent inbound `conversations` rows that have no outbound reply yet,
 * builds a short context (customer LTV, last orders, catalogue), asks Lovable
 * AI for a reply, then queues an outbound message in the same channel.
 *
 * Stateless per call — engine is responsible for scheduling.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

type InboundRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  channel: string;
  body: string;
  external_thread_id: string | null;
  created_at: string;
};

type ProductLite = { name: string; price_cents: number; currency: string; stock: number };

async function aiReply(opts: {
  brandName: string;
  customerName: string | null;
  history: { direction: string; body: string }[];
  catalogue: ProductLite[];
  lastBought: string | null;
}): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  const sys = [
    `You are the autonomous sales assistant for D2C brand "${opts.brandName}".`,
    `Goal: be warm, concise, close the sale. Reply in 1-3 short sentences max. Use customer's first name if known.`,
    `If they ask about products, recommend from the catalogue with price.`,
    `If unsure, ask one focused clarifying question.`,
    `Never say you are an AI. Never make up products or prices.`,
    opts.lastBought ? `Customer's last purchase: ${opts.lastBought}.` : "",
    `Catalogue (max 8 shown):`,
    ...opts.catalogue.slice(0, 8).map((p) => `- ${p.name} — ${(p.price_cents / 100).toFixed(0)} ${p.currency}${p.stock > 0 ? "" : " (out of stock)"}`),
  ].filter(Boolean).join("\n");

  const messages: { role: string; content: string }[] = [
    { role: "system", content: sys },
    ...opts.history.slice(-8).map((h) => ({
      role: h.direction === "inbound" ? "user" : "assistant",
      content: h.body,
    })),
  ];

  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
  };
  const out = json.choices?.[0]?.message?.content?.trim();
  return out && out.length > 0 ? out : null;
}

/** Process pending inbound conversations for a tenant. Returns reply count. */
export async function runSalesBotForTenant(tenantId: string, limit = 20): Promise<{ replied: number; skipped: number }> {
  // Pull recent inbound (last 24h) that we haven't auto-replied to yet
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: inbound } = await supabaseAdmin
    .from("conversations")
    .select("id, tenant_id, customer_id, channel, body, external_thread_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("direction", "inbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!inbound || inbound.length === 0) return { replied: 0, skipped: 0 };

  // Brand name for tone
  const { data: cfg } = await supabaseAdmin
    .from("tenant_configs")
    .select("brand_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const brandName = cfg?.brand_name ?? "this brand";

  // Catalogue
  const { data: products } = await supabaseAdmin
    .from("products")
    .select("name, price_cents, currency, stock")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("price_cents", { ascending: false })
    .limit(20);
  const catalogue = (products ?? []) as ProductLite[];

  // Group by customer (latest message per customer this batch)
  const seen = new Set<string>();
  const queue: InboundRow[] = [];
  for (const r of inbound as InboundRow[]) {
    const key = r.customer_id ?? r.external_thread_id ?? r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(r);
  }

  let replied = 0, skipped = 0;
  for (const r of queue) {
    if (!r.customer_id) { skipped++; continue; }

    // Skip if we already queued/sent an outbound after this inbound
    const { data: alreadySent } = await supabaseAdmin
      .from("outbound_messages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("customer_id", r.customer_id)
      .eq("trigger_kind", "sales_reply")
      .gte("created_at", r.created_at)
      .limit(1);
    if (alreadySent && alreadySent.length > 0) { skipped++; continue; }

    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("name, telegram_chat_id")
      .eq("id", r.customer_id)
      .maybeSingle();
    if (!customer?.telegram_chat_id && r.channel === "telegram") { skipped++; continue; }

    const { data: history } = await supabaseAdmin
      .from("conversations")
      .select("direction, body")
      .eq("tenant_id", tenantId)
      .eq("customer_id", r.customer_id)
      .order("created_at", { ascending: true })
      .limit(20);

    const { data: lastItem } = await supabaseAdmin
      .from("order_items")
      .select("product_name")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1);

    const reply = await aiReply({
      brandName,
      customerName: customer?.name ?? null,
      history: (history ?? []) as { direction: string; body: string }[],
      catalogue,
      lastBought: lastItem?.[0]?.product_name ?? null,
    });
    if (!reply) { skipped++; continue; }

    await supabaseAdmin.from("outbound_messages").insert({
      tenant_id: tenantId,
      customer_id: r.customer_id,
      channel: r.channel,
      trigger_kind: "sales_reply",
      template_key: "sales.ai.v1",
      body: reply,
      status: "pending",
      metadata: { in_response_to: r.id } as never,
    });
    // Also record outbound conversation row
    await supabaseAdmin.from("conversations").insert({
      tenant_id: tenantId,
      customer_id: r.customer_id,
      channel: r.channel,
      external_thread_id: r.external_thread_id,
      direction: "outbound",
      body: reply,
      intent: "sales_reply",
      metadata: { auto: true } as never,
    });
    replied++;
  }

  return { replied, skipped };
}
