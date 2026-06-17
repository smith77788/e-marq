/**
 * Smart Notification System — сповіщує власника бренду про можливості
 * зростання виручки в реальному часі.
 *
 * Типи сповіщень:
 * 1. Revenue Alert — раптове зростання/падіння продажів
 * 2. Stock Alert — товар закінчується
 * 3. Churn Risk — VIP клієнт збирається піти
 * 4. Opportunity — upsell/cross-sell можливість
 * 5. Agent Insight — агент знайшов щось важливе
 *
 * Доставка: Telegram + Email + in-app toast.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTelegramText } from "@/lib/acos/channels";
import { sendEmailViaGateway } from "@/lib/email/resendGateway";

export type NotificationType =
  | "revenue_alert"
  | "stock_alert"
  | "churn_risk"
  | "opportunity"
  | "agent_insight";

export type NotificationSeverity = "critical" | "high" | "medium" | "low";

export type Notification = {
  id: string;
  tenant_id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  action_url?: string;
  action_label?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

/**
 * Створити сповіщення та доставити через всі канали.
 */
export async function createNotification(
  tenantId: string,
  type: NotificationType,
  severity: NotificationSeverity,
  title: string,
  body: string,
  options?: { action_url?: string; action_label?: string; metadata?: Record<string, unknown> },
): Promise<{ ok: boolean; id?: string }> {
  // 1. Записати в БД
  const { data, error } = await supabaseAdmin
    .from("owner_notifications")
    .insert({
      tenant_id: tenantId,
      kind: type,
      severity,
      title,
      body,
      link: options?.action_url ?? null,
      metadata: (options?.metadata ?? {}) as never,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false };

  // 2. Доставити через Telegram (якщо налаштовано)
  await sendTelegramNotification(tenantId, title, body, options?.action_url);

  // 3. Доставити через email (якщо critical/high)
  if (severity === "critical" || severity === "high") {
    await sendEmailNotification(tenantId, title, body);
  }

  return { ok: true, id: data.id };
}

/**
 * Аналіз продажів в реальному часі — сповіщує про аномалії.
 */
export async function analyzeSalesAnomaly(tenantId: string): Promise<void> {
  // Порівняти продажі за останню годину з середнім за останній тиждень
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: recentOrders } = await supabaseAdmin
    .from("orders")
    .select("total_cents")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", hourAgo);

  const { data: weekOrders } = await supabaseAdmin
    .from("orders")
    .select("total_cents")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", weekAgo);

  if (!recentOrders || !weekOrders || weekOrders.length < 20) return;

  const recentTotal = recentOrders.reduce((s, o) => s + o.total_cents, 0);
  const avgHourly = weekOrders.reduce((s, o) => s + o.total_cents, 0) / (7 * 24);

  if (avgHourly === 0) return;

  const change = (recentTotal - avgHourly) / avgHourly;

  if (change > 0.5) {
    // +50% за годину — аномальне зростання
    await createNotification(tenantId, "revenue_alert", "high",
      "Продажі зросли на " + Math.round(change * 100) + "%",
      `За останню годину ${formatCents(recentTotal)} замість звичайних ${formatCents(avgHourly)}.`,
      { action_url: "/brand/roi", action_label: "Переглянути ROI" },
    );
  } else if (change < -0.5) {
    // -50% за годину — аномальне падіння
    await createNotification(tenantId, "revenue_alert", "critical",
      "Продажі впали на " + Math.round(Math.abs(change) * 100) + "%",
      `За останню годину лише ${formatCents(recentTotal)} замість звичайних ${formatCents(avgHourly)}.`,
      { action_url: "/brand/insights", action_label: "Переглянути інсайти" },
    );
  }
}

/**
 * Моніторинг запасів — сповіщує про товари що закінчуються.
 */
export async function monitorStockLevels(tenantId: string): Promise<void> {
  // Знайти товари з низьким запасом
  const { data: lowStock } = await supabaseAdmin
    .from("products")
    .select("id, name, stock")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .lte("stock", 5)
    .gt("stock", 0)
    .limit(10);

  if (!lowStock || lowStock.length === 0) return;

  // Перевірити чи вже є сповіщення про ці товари за останні 24 години
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from("owner_notifications")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .eq("kind", "stock_alert")
    .gte("created_at", dayAgo);

  const notifiedProductIds = new Set(
    (existing ?? []).map((n) => (n.metadata as Record<string, unknown>)?.product_id as string).filter(Boolean),
  );

  for (const product of lowStock) {
    if (notifiedProductIds.has(product.id)) continue;

    await createNotification(tenantId, "stock_alert", "medium",
      `Товар "${product.name}" закінчується`,
      `Залишилось ${product.stock} шт. Замовте поповнення.`,
      { action_url: "/brand/products", action_label: "Переглянути товари", metadata: { product_id: product.id } },
    );
  }
}

async function sendTelegramNotification(
  tenantId: string,
  title: string,
  body: string,
  actionUrl?: string,
): Promise<void> {
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("owner_telegram_chat_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const chatId = config?.owner_telegram_chat_id;
  if (!chatId) return;

  const appBase = process.env.PUBLIC_APP_URL ?? "https://e-marq.lovable.app";
  const lines = [`<b>${title}</b>`, body];
  if (actionUrl) lines.push(`\n👉 ${appBase.replace(/\/$/, "")}${actionUrl}`);

  await sendTelegramText(chatId, lines.join("\n")).catch(() => {/* non-critical */});
}

async function sendEmailNotification(
  tenantId: string,
  title: string,
  body: string,
): Promise<void> {
  const { data: config } = await supabaseAdmin
    .from("site_brand_profiles")
    .select("contact_email, brand_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const to = config?.contact_email;
  if (!to) return;

  const brandName = config?.brand_name ?? "MARQ";

  await sendEmailViaGateway({
    to,
    subject: `[${brandName}] ${title}`,
    html: `<h2>${title}</h2><p>${body}</p>`,
    text: `${title}\n\n${body}`,
    tenantId,
    category: "transactional",
  }).catch(() => {/* non-critical */});
}

function formatCents(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString("uk-UA")} ₴`;
}
