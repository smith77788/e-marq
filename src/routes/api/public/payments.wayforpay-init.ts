/**
 * POST /api/public/payments/wayforpay-init
 *
 * Body: { orderId: string }
 * Returns: { ok: true, action, formFields, intentId }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildWayForPayForm } from "@/lib/payments/wayforpay.server";
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

export const Route = createFileRoute("/api/public/payments/wayforpay-init")({
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

        const { data: order } = await supabaseAdmin
          .from("orders")
          .select("id, tenant_id, total_cents, currency, status, customer_email, customer_name")
          .eq("id", orderId)
          .maybeSingle();
        if (!order) {
          return Response.json({ ok: false, error: "order_not_found" }, { status: 404 });
        }
        if (order.status === "paid") {
          return Response.json({ ok: false, error: "already_paid" }, { status: 409 });
        }

        const { data: items } = await supabaseAdmin
          .from("order_items")
          .select("product_name, quantity, unit_price_cents")
          .eq("order_id", orderId);

        const { data: cfg } = await supabaseAdmin
          .from("tenant_configs")
          .select("features, brand_name")
          .eq("tenant_id", order.tenant_id)
          .maybeSingle();
        const gw = readGatewayConfig(cfg?.features);
        if (
          !gw.wayforpay_enabled ||
          !gw.wayforpay_merchant_account ||
          !gw.wayforpay_secret_key ||
          !gw.wayforpay_merchant_domain
        ) {
          return Response.json({ ok: false, error: "wayforpay_not_configured" }, { status: 503 });
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

        const products =
          items && items.length > 0
            ? items.map((i) => ({
                name: (i.product_name || "Item").slice(0, 100),
                price: i.unit_price_cents / 100,
                count: i.quantity,
              }))
            : [
                {
                  name: `${cfg?.brand_name || "Order"} #${order.id.slice(0, 8)}`,
                  price: order.total_cents / 100,
                  count: 1,
                },
              ];

        const out = buildWayForPayForm({
          merchantAccount: gw.wayforpay_merchant_account,
          merchantDomainName: gw.wayforpay_merchant_domain,
          secretKey: gw.wayforpay_secret_key,
          orderReference: order.id,
          amount: order.total_cents / 100,
          currency: order.currency || "UAH",
          products,
          clientEmail: order.customer_email ?? undefined,
          clientFirstName: order.customer_name ?? undefined,
          serviceUrl: `${baseUrl}/api/public/payments/wayforpay-callback`,
          returnUrl: `${baseUrl}/s/${tenant.slug}/orders/${order.id}`,
        });

        const { data: intentId } = await supabaseAdmin.rpc("create_payment_intent", {
          _order_id: order.id,
          _provider: "wayforpay",
          _amount_cents: order.total_cents,
          _redirect_url: out.action,
        });

        return Response.json({
          ok: true,
          provider: "wayforpay",
          action: out.action,
          formFields: out.fields,
          intentId,
        });
      },
    },
  },
});
