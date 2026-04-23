/**
 * Telegram owner-side commands.
 *
 * When a brand owner has bound their chat via `/start owner <slug>` we
 * recognise short commands here and answer with live data pulled from the
 * tenant's tables. The reply keyboard stays attached to every owner reply,
 * so the bot is essentially a pocket cockpit for the brand.
 *
 * Keep formatting cheap: HTML, no Markdown to avoid escaping bugs.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TG_GATEWAY = "https://connector-gateway.lovable.dev/telegram";

export const OWNER_KEYBOARD = {
  keyboard: [
    [{ text: "📊 Метрики" }, { text: "🛒 Замовлення" }],
    [{ text: "💡 Інсайти" }, { text: "🤖 Агенти" }],
    [{ text: "🌐 Сайт" }, { text: "ℹ️ Допомога" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
} as const;

const COMMAND_LABELS: Record<string, string> = {
  "📊 метрики": "/metrics",
  "🛒 замовлення": "/orders",
  "💡 інсайти": "/insights",
  "🤖 агенти": "/agents",
  "🌐 сайт": "/site",
  "ℹ️ допомога": "/help",
};

export function normalizeOwnerCommand(text: string): string | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (COMMAND_LABELS[lower]) return COMMAND_LABELS[lower];
  if (/^\/(menu|metrics|orders|insights|agents|site|help)\b/i.test(trimmed)) {
    return trimmed.toLowerCase().split(/\s+/)[0];
  }
  return null;
}

export async function sendOwnerMessage(
  chatId: string,
  text: string,
  withKeyboard = true,
): Promise<void> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey || !tgKey) return;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (withKeyboard) body.reply_markup = OWNER_KEYBOARD;
  await fetch(`${TG_GATEWAY}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": tgKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

function fmtMoney(cents: number): string {
  return `${(cents / 100).toFixed(0)} ₴`;
}

async function buildMetrics(tenantId: string, appOrigin: string): Promise<string> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [paid24, paid7, pending, customers, runs] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("paid_at", since24h),
    supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("paid_at", since7d),
    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending"),
    supabaseAdmin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabaseAdmin
      .from("acos_agent_runs")
      .select("status")
      .eq("tenant_id", tenantId)
      .gte("started_at", since24h),
  ]);

  const sum24 = (paid24.data ?? []).reduce((s, o) => s + (o.total_cents ?? 0), 0);
  const sum7 = (paid7.data ?? []).reduce((s, o) => s + (o.total_cents ?? 0), 0);
  const totalRuns = runs.data?.length ?? 0;
  const failedRuns = (runs.data ?? []).filter((r) => r.status === "failed").length;

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("name, slug")
    .eq("id", tenantId)
    .maybeSingle();

  return [
    `📊 <b>${tenant?.name ?? "Бренд"}</b> — короткі метрики`,
    ``,
    `💰 <b>Виручка 24 год:</b> ${fmtMoney(sum24)} (${paid24.data?.length ?? 0} замовлень)`,
    `📅 <b>Виручка 7 днів:</b> ${fmtMoney(sum7)} (${paid7.data?.length ?? 0} замовлень)`,
    `⏳ <b>Очікують оплати:</b> ${pending.count ?? 0}`,
    `👥 <b>Клієнтів усього:</b> ${customers.count ?? 0}`,
    `🤖 <b>Агенти 24 год:</b> ${totalRuns} запусків${failedRuns ? ` (⚠️ ${failedRuns} з помилкою)` : ""}`,
    ``,
    `🔗 Кокпіт: ${appOrigin}/brand?tenant=${tenantId}`,
  ].join("\n");
}

async function buildOrders(tenantId: string, appOrigin: string): Promise<string> {
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .maybeSingle();
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, total_cents, status, customer_email, customer_name, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (!orders || orders.length === 0) {
    return "🛒 Замовлень ще немає. Поділіться посиланням на вітрину з клієнтами.";
  }
  const lines = orders.map((o) => {
    const who = o.customer_name ?? o.customer_email ?? "—";
    const date = new Date(o.created_at).toLocaleString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `• <b>${fmtMoney(o.total_cents)}</b> · ${o.status} · ${who} · ${date}`;
  });
  return [
    `🛒 <b>Останні замовлення</b>`,
    ``,
    ...lines,
    ``,
    `🔗 Усі замовлення: ${appOrigin}/brand/orders?tenant=${tenantId}`,
  ].join("\n");
}

async function buildInsights(tenantId: string, appOrigin: string): Promise<string> {
  const { data: insights } = await supabaseAdmin
    .from("ai_insights")
    .select("id, title, expected_impact, status, created_at")
    .eq("tenant_id", tenantId)
    .in("status", ["new", "pending", "accepted"])
    .order("created_at", { ascending: false })
    .limit(6);

  if (!insights || insights.length === 0) {
    return [
      `💡 Активних інсайтів немає.`,
      ``,
      `Агенти проаналізують ваш бізнес найближчим запуском.`,
      `🔗 ${appOrigin}/brand?tenant=${tenantId}`,
    ].join("\n");
  }
  const lines = insights.map((i) => {
    const impact = i.expected_impact ? ` — ${i.expected_impact}` : "";
    return `• <b>${i.title}</b>${impact}`;
  });
  return [
    `💡 <b>Активні інсайти від агентів</b>`,
    ``,
    ...lines,
    ``,
    `🔗 Деталі: ${appOrigin}/brand?tenant=${tenantId}`,
  ].join("\n");
}

async function buildAgents(tenantId: string, appOrigin: string): Promise<string> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: runs } = await supabaseAdmin
    .from("acos_agent_runs")
    .select("agent_id, status, insights_created")
    .eq("tenant_id", tenantId)
    .gte("started_at", since24h);

  if (!runs || runs.length === 0) {
    return [
      `🤖 За останні 24 години запусків ще не було.`,
      ``,
      `🔗 Запустити агентів: ${appOrigin}/agents/live?tenant=${tenantId}`,
    ].join("\n");
  }

  type Agg = { ok: number; failed: number; insights: number };
  const grouped = new Map<string, Agg>();
  for (const r of runs) {
    const cur = grouped.get(r.agent_id) ?? { ok: 0, failed: 0, insights: 0 };
    if (r.status === "failed") cur.failed += 1;
    else cur.ok += 1;
    cur.insights += r.insights_created ?? 0;
    grouped.set(r.agent_id, cur);
  }
  const lines = Array.from(grouped.entries())
    .sort((a, b) => b[1].ok + b[1].failed - (a[1].ok + a[1].failed))
    .slice(0, 10)
    .map(([id, a]) => {
      const flag = a.failed > 0 ? "⚠️" : "✅";
      return `${flag} <code>${id}</code> · ${a.ok}✓ ${a.failed}✗ · +${a.insights} інс.`;
    });
  return [
    `🤖 <b>Активність агентів за 24 години</b>`,
    ``,
    ...lines,
    ``,
    `🔗 ${appOrigin}/agents/live?tenant=${tenantId}`,
  ].join("\n");
}

async function buildSite(tenantId: string, appOrigin: string): Promise<string> {
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("name, slug")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return "Бренд не знайдено.";
  return [
    `🌐 <b>${tenant.name}</b>`,
    ``,
    `Вітрина: ${appOrigin}/s/${tenant.slug}`,
    `Конструктор сайту: ${appOrigin}/brand/site-builder?tenant=${tenantId}`,
    `Кокпіт: ${appOrigin}/brand?tenant=${tenantId}`,
    `Telegram-посилання для клієнтів:`,
    `<code>https://t.me/Oauther_bot?start=${tenant.slug}</code>`,
  ].join("\n");
}

function buildHelp(): string {
  return [
    `ℹ️ <b>Команди для власника</b>`,
    ``,
    `📊 /metrics — короткі метрики (виручка, клієнти)`,
    `🛒 /orders — останні замовлення`,
    `💡 /insights — активні інсайти від агентів`,
    `🤖 /agents — активність агентів за 24 год`,
    `🌐 /site — посилання на ваш сайт і вітрину`,
    `ℹ️ /help — це повідомлення`,
    ``,
    `Або просто натисніть кнопку нижче 👇`,
  ].join("\n");
}

/** Returns true if the message was handled as an owner command. */
export async function handleOwnerCommand(
  tenantId: string,
  chatId: string,
  text: string,
  appOrigin: string,
): Promise<boolean> {
  const cmd = normalizeOwnerCommand(text);
  if (!cmd) return false;
  let body: string;
  switch (cmd) {
    case "/menu":
    case "/help":
      body = buildHelp();
      break;
    case "/metrics":
      body = await buildMetrics(tenantId, appOrigin);
      break;
    case "/orders":
      body = await buildOrders(tenantId, appOrigin);
      break;
    case "/insights":
      body = await buildInsights(tenantId, appOrigin);
      break;
    case "/agents":
      body = await buildAgents(tenantId, appOrigin);
      break;
    case "/site":
      body = await buildSite(tenantId, appOrigin);
      break;
    default:
      return false;
  }
  await sendOwnerMessage(chatId, body, true);
  return true;
}
