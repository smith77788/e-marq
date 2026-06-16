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
import { LOVABLE_AI_URL, DEFAULT_AI_MODEL, isLovableAiEnabled } from "@/lib/acos/aiKillswitch";

const MODEL = DEFAULT_AI_MODEL;

type InboundRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  channel: string;
  body: string;
  external_thread_id: string | null;
  created_at: string;
};

type ProductLite = {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  stock: number;
};

/** Fuzzy match: does the reply mention a product name (case-insensitive substring)? */
function findMentionedProduct(reply: string, catalogue: ProductLite[]): ProductLite | null {
  const lower = reply.toLowerCase();
  // Prefer longest name match first (avoids "Tee" matching when "Tee Shirt" is the real one)
  const sorted = [...catalogue].sort((a, b) => b.name.length - a.name.length);
  for (const p of sorted) {
    const n = p.name.toLowerCase();
    if (n.length >= 3 && lower.includes(n)) return p;
  }
  return null;
}

async function aiReply(opts: {
  brandName: string;
  storefrontBase: string | null;
  customerName: string | null;
  history: { direction: string; body: string }[];
  catalogue: ProductLite[];
  lastBought: string | null;
  lastInbound: string;
}): Promise<string | null> {
  // AI killswitch: за замовчуванням вимкнено → sales bot не відповідає до явного opt-in.
  if (!isLovableAiEnabled()) return null;
  const apiKey = process.env.LOVABLE_API_KEY!;

  // Heuristic language detection from the latest customer message:
  // default = Ukrainian; switch only when text is clearly English or Russian.
  const lastLower = (opts.lastInbound || "").toLowerCase();
  const hasCyrillic = /[\u0400-\u04ff]/.test(lastLower);
  const hasUkrainianMarkers = /[іїєґ]/.test(lastLower);
  const hasRussianOnlyMarkers = /[ыёэъ]/.test(lastLower);
  const looksEnglish = !hasCyrillic && /[a-z]/.test(lastLower);
  const lang = looksEnglish
    ? "English"
    : hasRussianOnlyMarkers && !hasUkrainianMarkers
      ? "Russian"
      : "Ukrainian";

  const sys = [
    `You are the autonomous sales assistant for the Ukrainian D2C brand "${opts.brandName}".`,
    `Default language is Ukrainian. The customer's most recent message looks ${lang}, so reply in ${lang}. If unsure — use Ukrainian.`,
    `Goal: be warm, concise, close the sale. Reply in 1–3 short sentences max. Use the customer's first name if known.`,
    `Prices are in Ukrainian hryvnia (₴). Always show the price as "1 234 ₴" — never use "$" or USD.`,
    `If they ask "скільки коштує" / "ціна" / "є в наявності" / "що у вас є" — name the product and price clearly from the catalogue.`,
    `If they pick a specific product, confirm it and tell them you'll send a checkout link.`,
    `If unsure what they want, ask one focused clarifying question.`,
    `Never say you are an AI. Never make up products or prices. Never invent links.`,
    opts.lastBought ? `Customer's last purchase: ${opts.lastBought}.` : "",
    `Catalogue (max 8 shown):`,
    ...opts.catalogue
      .slice(0, 8)
      .map(
        (p) =>
          `- ${p.name} — ${(p.price_cents / 100).toFixed(0)} ₴${p.stock > 0 ? "" : " (немає в наявності)"}`,
      ),
  ]
    .filter(Boolean)
    .join("\n");

  const messages: { role: string; content: string }[] = [
    { role: "system", content: sys },
    ...opts.history.slice(-8).map((h) => ({
      role: h.direction === "inbound" ? "user" : "assistant",
      content: h.body,
    })),
  ];

  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
  };
  let out = json.choices?.[0]?.message?.content?.trim();
  if (!out) return null;

  // Auto-append shop link when AI mentioned a real product and we know the storefront
  if (opts.storefrontBase) {
    const product = findMentionedProduct(out, opts.catalogue);
    if (product && product.stock > 0 && !out.includes(opts.storefrontBase)) {
      out += `\n\n👉 ${opts.storefrontBase}`;
    }
  }
  return out;
}

/** Process pending inbound conversations for a tenant. Returns reply count. */
export async function runSalesBotForTenant(
  tenantId: string,
  limit = 20,
): Promise<{ replied: number; skipped: number }> {
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

  // Brand name + slug for storefront link
  const [{ data: cfg }, { data: tenantRow }] = await Promise.all([
    supabaseAdmin
      .from("tenant_configs")
      .select("brand_name")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
  ]);
  const brandName = cfg?.brand_name ?? "this brand";
  const publicBase =
    process.env.PUBLIC_APP_URL ??
    process.env.SUPABASE_URL?.replace(/\.supabase\.co.*$/, ".lovable.app") ??
    null;
  const storefrontBase =
    tenantRow?.slug && publicBase ? `${publicBase.replace(/\/$/, "")}/s/${tenantRow.slug}` : null;

  // Catalogue
  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents, currency, stock")
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

  // Batch-prefetch to avoid N+1: one query for dedup check, one for customer data.
  const queuedCustomerIds = [...new Set(queue.map((r) => r.customer_id).filter(Boolean))] as string[];

  const [{ data: sentRows }, { data: customerRows }] = await Promise.all([
    supabaseAdmin
      .from("outbound_messages")
      .select("customer_id")
      .eq("tenant_id", tenantId)
      .in("customer_id", queuedCustomerIds)
      .eq("trigger_kind", "sales_reply")
      .gte("created_at", since)
      .limit(queuedCustomerIds.length * 2),
    supabaseAdmin
      .from("customers")
      .select("id, name, telegram_chat_id")
      .in("id", queuedCustomerIds)
      .limit(queuedCustomerIds.length),
  ]);
  const alreadySentIds = new Set(sentRows?.map((r) => r.customer_id) ?? []);
  const customerMap = new Map((customerRows ?? []).map((c) => [c.id, c]));

  let replied = 0,
    skipped = 0;
  for (const r of queue) {
    if (!r.customer_id) {
      skipped++;
      continue;
    }

    if (alreadySentIds.has(r.customer_id)) {
      skipped++;
      continue;
    }

    const customer = customerMap.get(r.customer_id);
    if (!customer?.telegram_chat_id && r.channel === "telegram") {
      skipped++;
      continue;
    }

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
      storefrontBase,
      customerName: customer?.name ?? null,
      history: (history ?? []) as { direction: string; body: string }[],
      catalogue,
      lastBought: lastItem?.[0]?.product_name ?? null,
      lastInbound: r.body,
    });
    if (!reply) {
      skipped++;
      continue;
    }

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
