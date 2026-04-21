/**
 * Helper builders for converting domain entities into universal DetailPayload.
 *
 * Why builders? Each "row type" (outbound message, insight, customer, agent
 * event, product) shares the same DetailPayload shape but has very different
 * source data. Centralising the mapping here keeps wrappers in components tiny
 * and makes the payloads testable / consistent.
 */
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/money";
import type { DetailPayload, MetricBlock } from "./types";

/* ------------------------------ Outbound msg ------------------------------ */

const STATUS_LABEL: Record<string, { label: string; tone: MetricBlock["tone"] }> = {
  pending: { label: "У черзі", tone: "default" },
  sent: { label: "Надіслано", tone: "primary" },
  failed: { label: "Помилка", tone: "destructive" },
  replied: { label: "Відповіли", tone: "warning" },
  converted: { label: "Куплено", tone: "success" },
};

const TRIGGER_LABEL: Record<string, string> = {
  reorder: "Повторне замовлення",
  winback: "Повернення клієнта",
  abandoned_cart: "Покинутий кошик",
  sales_reply: "Відповідь продавця",
  promo: "Промо",
};

export type OutboundDetailRow = {
  id: string;
  channel: string;
  trigger_kind: string;
  body: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  replied_at: string | null;
  converted_at: string | null;
  expected_impact_cents: number | null;
  actual_revenue_cents: number | null;
  customer_id: string | null;
  customers?: { name: string | null; email: string | null; telegram_username: string | null } | null;
};

export function buildOutboundPayload(r: OutboundDetailRow): DetailPayload {
  const status = STATUS_LABEL[r.status] ?? STATUS_LABEL.pending;
  const customerLabel =
    r.customers?.name ?? r.customers?.email ??
    (r.customers?.telegram_username ? `@${r.customers.telegram_username}` : "анонім");

  const metrics: MetricBlock[] = [
    { label: "Канал", value: r.channel },
    { label: "Тригер", value: TRIGGER_LABEL[r.trigger_kind] ?? r.trigger_kind },
    { label: "Клієнт", value: customerLabel },
  ];
  if (r.expected_impact_cents != null) {
    metrics.push({ label: "Прогноз доходу", value: formatMoney(r.expected_impact_cents), tone: "primary" });
  }
  if (r.actual_revenue_cents != null) {
    metrics.push({ label: "Фактичний дохід", value: formatMoney(r.actual_revenue_cents), tone: "success" });
  }

  const log: DetailPayload["events_log"] = [];
  log.push({ id: "scheduled", at: r.scheduled_for, title: "Заплановано", icon: "info" });
  if (r.sent_at) log.push({ id: "sent", at: r.sent_at, title: "Надіслано клієнту", icon: "info" });
  if (r.replied_at) log.push({ id: "replied", at: r.replied_at, title: "Клієнт відповів", icon: "warning" });
  if (r.converted_at) log.push({ id: "converted", at: r.converted_at, title: "Зробив покупку", icon: "success" });
  log.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    title: TRIGGER_LABEL[r.trigger_kind] ?? r.trigger_kind,
    subtitle: `→ ${customerLabel}`,
    status: { label: status.label, tone: status.tone },
    metrics,
    description: r.body.replace(/<[^>]+>/g, ""),
    events_log: log,
    metadata: {
      "ID": r.id,
      "Канал": r.channel,
      "Тригер": r.trigger_kind,
      "Статус": r.status,
    },
  };
}

/* ------------------------------- AI Insight ------------------------------- */

const RISK_TONE: Record<string, MetricBlock["tone"]> = {
  high: "destructive",
  medium: "warning",
  low: "default",
};

export type InsightDetailRow = {
  id: string;
  insight_type: string;
  title: string;
  description: string;
  expected_impact: string | null;
  confidence: number;
  risk_level: string;
  status: string;
  created_at: string;
  metrics: Record<string, unknown>;
};

export function buildInsightPayload(i: InsightDetailRow): DetailPayload {
  const metrics: MetricBlock[] = [
    { label: "Впевненість", value: `${Math.round(i.confidence * 100)}%`, tone: "primary" },
    { label: "Ризик", value: i.risk_level, tone: RISK_TONE[i.risk_level] ?? "default" },
    { label: "Статус", value: i.status },
  ];
  if (i.expected_impact) metrics.push({ label: "Очікуваний ефект", value: i.expected_impact, tone: "success" });

  return {
    title: i.title,
    subtitle: i.insight_type.replace(/_/g, " "),
    status: { label: i.status, tone: i.status === "new" ? "primary" : "default" },
    metrics,
    description: i.description,
    events_log: [{ id: "created", at: i.created_at, title: "Створено агентом", icon: "info" }],
    metadata: Object.fromEntries(
      Object.entries(i.metrics ?? {})
        .filter(([k]) => !k.startsWith("_"))
        .slice(0, 12)
        .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean | null)]),
    ),
  };
}

/* -------------------------------- Customer -------------------------------- */

export type CustomerDetailRow = {
  id: string;
  name: string | null;
  email: string | null;
  telegram_username: string | null;
  telegram_chat_id: string | null;
  lifecycle_stage: string;
  total_orders: number;
  total_spent_cents: number;
  last_order_at: string | null;
  predicted_next_order_at: string | null;
  consent_marketing?: boolean;
  avg_order_cents?: number;
  avg_cycle_days?: number | null;
  first_order_at?: string | null;
};

const STAGE_TONE: Record<string, MetricBlock["tone"]> = {
  vip: "primary",
  active: "success",
  at_risk: "warning",
  dormant: "default",
  new: "default",
};

const STAGE_LABEL: Record<string, string> = {
  vip: "VIP",
  active: "активний",
  new: "новий",
  at_risk: "ризик піти",
  dormant: "сплячий",
};

export async function fetchCustomerDetail(tenantId: string, customerId: string): Promise<DetailPayload> {
  const { data: c, error } = await supabase
    .from("customers")
    .select("id, name, email, telegram_username, telegram_chat_id, lifecycle_stage, total_orders, total_spent_cents, last_order_at, predicted_next_order_at, consent_marketing, avg_order_cents, avg_cycle_days, first_order_at")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!c) throw new Error("Клієнт не знайдений");

  // Recent orders attached by customer email match (orders.customer_user_id is auth.users.id, not customers.id).
  let orders: { id: string; created_at: string; total_cents: number; status: string; payment_method: string }[] = [];
  if (c.email) {
    const { data } = await supabase
      .from("orders")
      .select("id, created_at, total_cents, status, payment_method")
      .eq("tenant_id", tenantId)
      .eq("customer_email", c.email)
      .order("created_at", { ascending: false })
      .limit(10);
    orders = data ?? [];
  }

  return buildCustomerPayload(c as CustomerDetailRow, orders);
}

export function buildCustomerPayload(
  c: CustomerDetailRow,
  recentOrders: { id: string; created_at: string; total_cents: number; status: string; payment_method: string }[] = [],
): DetailPayload {
  const stageLabel = STAGE_LABEL[c.lifecycle_stage] ?? c.lifecycle_stage;
  const stageTone = STAGE_TONE[c.lifecycle_stage] ?? "default";
  const overdue = c.predicted_next_order_at && new Date(c.predicted_next_order_at) < new Date();

  const metrics: MetricBlock[] = [
    { label: "Замовлень", value: String(c.total_orders) },
    { label: "Витратив", value: formatMoney(c.total_spent_cents), tone: "primary" },
    { label: "Середній чек", value: formatMoney(c.avg_order_cents ?? 0) },
    { label: "Етап", value: stageLabel, tone: stageTone },
  ];
  if (c.avg_cycle_days != null) {
    metrics.push({ label: "Цикл (днів)", value: String(Math.round(c.avg_cycle_days)) });
  }
  if (c.predicted_next_order_at) {
    metrics.push({
      label: "Наступна покупка",
      value: new Date(c.predicted_next_order_at).toLocaleDateString("uk-UA"),
      tone: overdue ? "warning" : "default",
    });
  }

  const log: DetailPayload["events_log"] = [];
  if (c.first_order_at) log.push({ id: "first", at: c.first_order_at, title: "Перше замовлення", icon: "info" });
  if (c.last_order_at) log.push({ id: "last", at: c.last_order_at, title: "Останнє замовлення", icon: "info" });
  for (const o of recentOrders) {
    log.push({
      id: `o-${o.id}`,
      at: o.created_at,
      title: `Замовлення ${formatMoney(o.total_cents)}`,
      description: `${o.status} · ${o.payment_method}`,
      icon: o.status === "paid" ? "success" : o.status === "cancelled" ? "destructive" : "info",
    });
  }
  log.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const channels: string[] = [];
  if (c.email) channels.push(`Email: ${c.email}`);
  if (c.telegram_username) channels.push(`Telegram: @${c.telegram_username}`);
  if (c.telegram_chat_id && !c.telegram_username) channels.push(`Telegram: chat ${c.telegram_chat_id}`);

  return {
    title: c.name ?? c.email ?? (c.telegram_username ? `@${c.telegram_username}` : "Анонім"),
    subtitle: channels.join(" · ") || "Немає контактів",
    status: { label: stageLabel, tone: stageTone },
    metrics,
    description: overdue
      ? "Час нагадати про себе — клієнт вже мав би повернутися. Натисніть «Повернути», щоб надіслати персональне повідомлення."
      : undefined,
    events_log: log,
    metadata: {
      "ID": c.id,
      "Email": c.email ?? "—",
      "Telegram": c.telegram_username ? `@${c.telegram_username}` : (c.telegram_chat_id ?? "—"),
      "Згода на розсилки": c.consent_marketing ? "так" : "ні",
    },
  };
}

/* --------------------------- Agent timeline event ------------------------- */

export type TimelineKind = "insight" | "action" | "outbound" | "run";

export function buildTimelinePayload(args: {
  kind: TimelineKind;
  title: string;
  detail: string;
  ts: number;
  badge?: string;
}): DetailPayload {
  const kindLabel: Record<TimelineKind, string> = {
    insight: "Інсайт",
    action: "Дія",
    outbound: "Повідомлення",
    run: "Запуск агента",
  };
  return {
    title: args.title,
    subtitle: kindLabel[args.kind],
    status: args.badge ? { label: args.badge } : undefined,
    description: args.detail,
    metrics: [
      { label: "Тип", value: kindLabel[args.kind] },
      { label: "Коли", value: formatDistanceToNow(args.ts, { addSuffix: true, locale: uk }) },
    ],
    events_log: [{ id: "happened", at: new Date(args.ts).toISOString(), title: args.title, description: args.detail, icon: "info" }],
  };
}

/* -------------------------------- Product --------------------------------- */

export type StorefrontProductRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  stock: number; // already masked (9999 / 0)
};

export function buildStorefrontProductPayload(p: StorefrontProductRow): DetailPayload {
  const inStock = p.stock > 0;
  return {
    title: p.name,
    subtitle: `${(p.price_cents / 100).toFixed(2)} ${p.currency}`,
    status: {
      label: inStock ? "В наявності" : "Немає в наявності",
      tone: inStock ? "success" : "destructive",
    },
    metrics: [
      { label: "Ціна", value: `${(p.price_cents / 100).toFixed(2)} ${p.currency}`, tone: "primary" },
      { label: "Валюта", value: p.currency },
      { label: "Статус", value: inStock ? "Доступний" : "Недоступний", tone: inStock ? "success" : "destructive" },
    ],
    description: p.description ?? "Опис відсутній. Зверніться до продавця для деталей.",
    media: p.image_url ? [{ url: p.image_url, alt: p.name, kind: "image" }] : [],
    metadata: {
      "ID": p.id,
      "Валюта": p.currency,
      "Наявність": inStock ? "так" : "ні",
    },
  };
}
