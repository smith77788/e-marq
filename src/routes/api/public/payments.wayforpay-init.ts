/**
 * POST /api/public/payments/wayforpay-init
 *
 * Body: { orderId: string }
 * Returns: { ok: true, action, formFields, intentId }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildWayForPayForm } from "@/lib/payments/wayforpay.server";
import { readGatewayConfig } from "@/lib/payments/types";

import { clientIp, originUrl, createIpRateLimiter } from "@/lib/http/rateLimit";

const wayForPayInitBodySchema = z.object({
  orderId: z.string().uuid(),
});

const limiter = createIpRateLimiter({ limit: 10 });

export const Route = createFileRoute("/api/public/payments/wayforpay-init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!limiter.check(ip)) {
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }

        let rawBody: unknown;
        try {
          rawBody = await request.json();
        } catch {
          return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
        }

        const parsedBody = wayForPayInitBodySchema.safeParse(rawBody);
        if (!parsedBody.success) {
          return Response.json({ ok: false, error: "invalid_order_id" }, { status: 400 });
        }
        const orderId = parsedBody.data.orderId;

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
                name: (i.product_name || "Товар").slice(0, 100),
                price: i.unit_price_cents / 100,
                count: i.quantity,
              }))
            : [
                {
                  name: `${cfg?.brand_name || "Замовлення"} #${order.id.slice(0, 8)}`,
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

        const { data: intentId, error: intentErr } = await supabaseAdmin.rpc(
          "create_payment_intent",
          {
            _order_id: order.id,
            _provider: "wayforpay",
            _amount_cents: order.total_cents,
            _redirect_url: out.action,
          },
        );
        if (intentErr) {
          console.error("[wayforpay-init] create_payment_intent failed:", intentErr.message);
          return Response.json({ ok: false, error: "payment_intent_failed" }, { status: 500 });
        }

        return Response.json({
          ok: true,
          provider: "wayforpay",
          action: out.action,
          formFields: out.fields,
          intentId: intentId ?? null,
        });
      },
    },
  },
});
