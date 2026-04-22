/**
 * Серверний helper: збирає повний контекст замовлення для email-шаблонів.
 *
 * Виконується ВИКЛЮЧНО на сервері (server routes / hooks), використовує
 * service role клієнт для обходу RLS.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { OrderEmailContext } from "./templates";

export type LoadOrderResult =
  | { ok: true; ctx: OrderEmailContext; tenantId: string; orderId: string }
  | { ok: false; status: number; error: string };

function buildOrderUrl(slug: string, orderId: string): string {
  const base =
    process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || "https://e-marq.lovable.app";
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/s/${encodeURIComponent(slug)}/orders/${orderId}`;
}

function buildStoreUrl(slug: string): string {
  const base =
    process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || "https://e-marq.lovable.app";
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/s/${encodeURIComponent(slug)}`;
}

function summarizeShipping(shipping: unknown): string | null {
  if (!shipping || typeof shipping !== "object") return null;
  const s = shipping as Record<string, unknown>;
  const city = typeof s.city_name === "string" ? s.city_name : null;
  const wh =
    typeof s.warehouse_description === "string"
      ? s.warehouse_description
      : typeof s.warehouse_number === "string"
        ? `Відділення №${s.warehouse_number}`
        : null;
  if (!city && !wh) return null;
  return [city, wh].filter(Boolean).join(", ");
}

export async function loadOrderEmailContext(orderId: string): Promise<LoadOrderResult> {
  const { data: order, error: oErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, tenant_id, customer_email, customer_name, total_cents, currency, payment_method, shipping_address, status",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (oErr) return { ok: false, status: 500, error: `DB error: ${oErr.message}` };
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (!order.customer_email)
    return { ok: false, status: 400, error: "Order has no customer email" };

  const [{ data: items, error: iErr }, { data: tenant, error: tErr }, { data: cfg }] =
    await Promise.all([
      supabaseAdmin
        .from("order_items")
        .select("product_name, quantity, unit_price_cents")
        .eq("order_id", orderId),
      supabaseAdmin
        .from("tenants")
        .select("id, slug, name")
        .eq("id", order.tenant_id)
        .maybeSingle(),
      supabaseAdmin
        .from("tenant_configs")
        .select("brand_name, features")
        .eq("tenant_id", order.tenant_id)
        .maybeSingle(),
    ]);

  if (iErr) return { ok: false, status: 500, error: `DB error (items): ${iErr.message}` };
  if (tErr || !tenant) return { ok: false, status: 404, error: "Tenant not found" };

  const features = (cfg?.features as Record<string, unknown> | null) ?? {};
  const payments = (features.payments as { manual_instructions?: string } | undefined) ?? {};

  const ctx: OrderEmailContext = {
    brandName: cfg?.brand_name ?? tenant.name ?? "Store",
    storeUrl: buildStoreUrl(tenant.slug),
    orderUrl: buildOrderUrl(tenant.slug, order.id),
    orderShortId: order.id.slice(0, 8),
    customerName: order.customer_name ?? null,
    customerEmail: order.customer_email,
    totalCents: order.total_cents,
    currency: order.currency || "UAH",
    items: (items ?? []).map((it) => ({
      name: it.product_name,
      quantity: it.quantity,
      unit_price_cents: it.unit_price_cents,
    })),
    paymentMethod: order.payment_method,
    paymentInstructions:
      order.payment_method === "manual" ? (payments.manual_instructions ?? null) : null,
    shippingSummary: summarizeShipping(order.shipping_address),
  };

  return { ok: true, ctx, tenantId: order.tenant_id, orderId: order.id };
}

/**
 * Лог відправлення в email_sends. Idempotency: якщо для (order_id, template)
 * вже є рядок зі status='sent', нову відправку НЕ робимо.
 */
export async function alreadySent(orderId: string, template: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("email_sends")
    .select("id")
    .eq("order_id", orderId)
    .eq("template", template)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

export async function logEmailSend(input: {
  tenantId: string;
  orderId: string;
  toEmail: string;
  template: string;
  subject: string;
  status: "sent" | "failed";
  resendMessageId?: string;
  error?: string;
}): Promise<void> {
  await supabaseAdmin.from("email_sends").insert({
    tenant_id: input.tenantId,
    order_id: input.orderId,
    to_email: input.toEmail,
    template: input.template,
    subject: input.subject,
    status: input.status,
    resend_message_id: input.resendMessageId ?? null,
    error: input.error ?? null,
  });
}
