/**
 * POST /api/public/payments/monobank-init
 *
 * Body: { orderId: string }
 * Returns: { ok: true, redirectUrl, intentId }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createMonoInvoice, currencyCodeNumeric } from "@/lib/payments/monobank.server";
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

export const Route = createFileRoute("/api/public/payments/monobank-init")({
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
          .select("id, tenant_id, total_cents, currency, status")
          .eq("id", orderId)
          .maybeSingle();
        if (!order) {
          return Response.json({ ok: false, error: "order_not_found" }, { status: 404 });
        }
        if (order.status === "paid") {
          return Response.json({ ok: false, error: "already_paid" }, { status: 409 });
        }

        const { data: cfg } = await supabaseAdmin
          .from("tenant_configs")
          .select("features, brand_name")
          .eq("tenant_id", order.tenant_id)
          .maybeSingle();
        const gw = readGatewayConfig(cfg?.features);
        if (!gw.monobank_enabled || !gw.monobank_token) {
          return Response.json({ ok: false, error: "monobank_not_configured" }, { status: 503 });
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
        const result = await createMonoInvoice({
          token: gw.monobank_token,
          amountCents: order.total_cents,
          currency: currencyCodeNumeric(order.currency || "UAH"),
          orderRef: order.id,
          reference: order.id,
          destination: `${cfg?.brand_name || "Замовлення"} #${order.id.slice(0, 8)}`.slice(0, 200),
          webHookUrl: `${baseUrl}/api/public/payments/monobank-callback`,
          redirectUrl: `${baseUrl}/s/${tenant.slug}/orders/${order.id}`,
        });

        if (!result.ok) {
          return Response.json(
            { ok: false, error: result.error, status: result.status },
            { status: 502 },
          );
        }

        const { data: intentId, error: intentErr } = await supabaseAdmin.rpc(
          "create_payment_intent",
          {
            _order_id: order.id,
            _provider: "monobank",
            _amount_cents: order.total_cents,
            _redirect_url: result.pageUrl,
          },
        );
        if (intentErr) {
          console.error("[monobank-init] create_payment_intent failed:", intentErr.message);
        }

        // Зберегти invoice_id у external_id intent'а одразу
        if (intentId) {
          await supabaseAdmin
            .from("payment_intents")
            .update({ external_id: result.invoiceId })
            .eq("id", intentId);
        }

        return Response.json({
          ok: true,
          provider: "monobank",
          redirectUrl: result.pageUrl,
          intentId,
        });
      },
    },
  },
});
