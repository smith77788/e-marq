/**
 * POST /api/public/payments/liqpay-init
 *
 * Викликається з checkout (анонімний покупець) щоб згенерувати data+signature
 * для self-submit форми на https://www.liqpay.ua/api/3/checkout.
 *
 * Body: { orderId: string }
 * Returns: { ok: true, formFields: { data, signature }, action: string, intentId }
 *          | { ok: false, error: string }
 *
 * Безпека:
 * - private_key НЕ виставляється клієнту, лише data+signature
 * - перевіряємо що orderId існує і ще не оплачено
 * - amount беремо з orders (клієнт не може його змінити)
 * - rate-limit per-IP
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildLiqPayCheckout } from "@/lib/payments/liqpay.server";
import { readGatewayConfig } from "@/lib/payments/types";

const ipBuckets = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 10;

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const b = ipBuckets.get(ip);
  if (!b || b.reset < now) {
    ipBuckets.set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  if (b.count >= RATE_LIMIT) return false;
  b.count += 1;
  return true;
}

function originUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || req.headers.get("x-forwarded-host") || "";
  return `${proto}://${host}`;
}

export const Route = createFileRoute("/api/public/payments/liqpay-init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(ip)) {
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }

        let body: { orderId?: unknown };
        try {
          body = (await request.json()) as { orderId?: unknown };
        } catch {
          return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
        }
        const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
          return Response.json({ ok: false, error: "invalid_order_id" }, { status: 400 });
        }

        // Load order
        const { data: order, error: orderErr } = await supabaseAdmin
          .from("orders")
          .select("id, tenant_id, total_cents, currency, status, customer_email, customer_name")
          .eq("id", orderId)
          .maybeSingle();
        if (orderErr || !order) {
          return Response.json({ ok: false, error: "order_not_found" }, { status: 404 });
        }
        if (order.status === "paid") {
          return Response.json({ ok: false, error: "already_paid" }, { status: 409 });
        }

        // Load tenant config
        const { data: cfg } = await supabaseAdmin
          .from("tenant_configs")
          .select("features, brand_name")
          .eq("tenant_id", order.tenant_id)
          .maybeSingle();
        const gw = readGatewayConfig(cfg?.features);
        if (!gw.liqpay_enabled || !gw.liqpay_public_key || !gw.liqpay_private_key) {
          return Response.json({ ok: false, error: "liqpay_not_configured" }, { status: 503 });
        }

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("slug")
          .eq("id", order.tenant_id)
          .maybeSingle();
        if (!tenant?.slug) {
          return Response.json({ ok: false, error: "tenant_not_found" }, { status: 404 });
        }

        const baseUrl = originUrl(request);
        const resultUrl = `${baseUrl}/s/${tenant.slug}/orders/${order.id}`;
        const serverUrl = `${baseUrl}/api/public/payments/liqpay-callback`;

        const amountUah = order.total_cents / 100;
        const description = `${cfg?.brand_name || "Замовлення"} · #${order.id.slice(0, 8)}`.slice(
          0,
          200,
        );

        const out = buildLiqPayCheckout({
          publicKey: gw.liqpay_public_key,
          privateKey: gw.liqpay_private_key,
          amount: amountUah,
          currency: order.currency || "UAH",
          description,
          orderId: order.id,
          resultUrl,
          serverUrl,
        });

        // Create intent
        const { data: intentId } = await supabaseAdmin.rpc("create_payment_intent", {
          _order_id: order.id,
          _provider: "liqpay",
          _amount_cents: order.total_cents,
          _redirect_url: out.checkoutUrl,
        });

        return Response.json({
          ok: true,
          provider: "liqpay",
          formFields: { data: out.data, signature: out.signature },
          action: out.checkoutUrl,
          intentId,
        });
      },
    },
  },
});
