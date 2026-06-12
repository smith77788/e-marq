/**
 * POST /api/public/payments/wayforpay-callback
 *
 * Body: JSON з полями transaction (див. WayForPay docs).
 * Відповідь має бути JSON ack {orderReference, status:"accept", time, signature}.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildWayForPayAck,
  isWayForPaySuccess,
  verifyWayForPayCallback,
  type WayForPayCallback,
} from "@/lib/payments/wayforpay.server";
import { readGatewayConfig } from "@/lib/payments/types";

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function logCallback(args: {
  orderId?: string | null;
  tenantId?: string | null;
  externalId?: string | null;
  signatureValid: boolean;
  rawBody: string;
  parsed: unknown;
  httpStatus: number;
  ip: string;
}) {
  await supabaseAdmin.from("payment_callbacks_log").insert({
    provider: "wayforpay",
    order_id: args.orderId ?? null,
    tenant_id: args.tenantId ?? null,
    external_id: args.externalId ?? null,
    signature_valid: args.signatureValid,
    raw_body: args.rawBody.slice(0, 8000),
    parsed_payload: (args.parsed ?? {}) as never,
    http_status: args.httpStatus,
    ip: args.ip,
  });
}

export const Route = createFileRoute("/api/public/payments/wayforpay-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const rawBody = await request.text();

        let parsed: WayForPayCallback;
        try {
          parsed = JSON.parse(rawBody) as WayForPayCallback;
        } catch {
          await logCallback({
            signatureValid: false,
            rawBody,
            parsed: { error: "bad_json" },
            httpStatus: 400,
            ip,
          });
          return new Response("bad_json", { status: 400 });
        }

        const orderId = String(parsed.orderReference || "").trim();
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
          await logCallback({
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 400,
            ip,
          });
          return new Response("invalid_order", { status: 400 });
        }

        const { data: order } = await supabaseAdmin
          .from("orders")
          .select("id, tenant_id, total_cents, currency")
          .eq("id", orderId)
          .maybeSingle();
        if (!order) {
          await logCallback({
            orderId,
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 404,
            ip,
          });
          return new Response("order_not_found", { status: 404 });
        }

        const { data: cfg } = await supabaseAdmin
          .from("tenant_configs")
          .select("features")
          .eq("tenant_id", order.tenant_id)
          .maybeSingle();
        const gw = readGatewayConfig(cfg?.features);
        if (!gw.wayforpay_secret_key) {
          await logCallback({
            orderId,
            tenantId: order.tenant_id,
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 503,
            ip,
          });
          return new Response("not_configured", { status: 503 });
        }

        const valid = verifyWayForPayCallback(gw.wayforpay_secret_key, parsed);
        const externalId = String(parsed.authCode || "");
        const amountCents = Math.round(Number(parsed.amount) * 100);

        if (!valid) {
          await logCallback({
            orderId,
            tenantId: order.tenant_id,
            externalId,
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 401,
            ip,
          });
          return new Response("invalid_signature", { status: 401 });
        }

        // Валюта callback'а має збігатися з валютою замовлення:
        // amount-guard у RPC порівнює лише числа, 2000 USD != 2000 UAH.
        const orderCurrency = (order.currency || "UAH").toUpperCase();
        if (String(parsed.currency || "").toUpperCase() !== orderCurrency) {
          await logCallback({
            orderId,
            tenantId: order.tenant_id,
            externalId,
            signatureValid: true,
            rawBody,
            parsed: { ...parsed, error: "currency_mismatch" },
            httpStatus: 400,
            ip,
          });
          return new Response("currency_mismatch", { status: 400 });
        }

        if (isWayForPaySuccess(parsed.transactionStatus)) {
          const { error: rpcErr } = await supabaseAdmin.rpc("mark_order_paid_by_gateway", {
            _order_id: orderId,
            _provider: "wayforpay",
            _external_id: externalId,
            _amount_cents: amountCents,
            _payload: parsed as never,
          });
          if (rpcErr) {
            await logCallback({
              orderId,
              tenantId: order.tenant_id,
              externalId,
              signatureValid: true,
              rawBody,
              parsed: { ...parsed, error: rpcErr.message },
              httpStatus: 500,
              ip,
            });
            return new Response("rpc_failed", { status: 500 });
          }
        } else {
          const { error: failErr } = await supabaseAdmin.rpc("mark_payment_failed", {
            _order_id: orderId,
            _provider: "wayforpay",
            _external_id: externalId,
            _error: `${parsed.transactionStatus}: ${parsed.reasonCode ?? ""}`,
            _payload: parsed as never,
          });
          if (failErr) {
            // Recording the failure failed — return 500 (not the accept ack) so
            // WayForPay retries rather than treating the payment as resolved.
            await logCallback({
              orderId,
              tenantId: order.tenant_id,
              externalId,
              signatureValid: true,
              rawBody,
              parsed: { ...parsed, error: failErr.message },
              httpStatus: 500,
              ip,
            });
            return new Response("rpc_failed", { status: 500 });
          }
        }

        await logCallback({
          orderId,
          tenantId: order.tenant_id,
          externalId,
          signatureValid: true,
          rawBody,
          parsed,
          httpStatus: 200,
          ip,
        });

        const ack = buildWayForPayAck(gw.wayforpay_secret_key, orderId);
        return Response.json(ack, { status: 200 });
      },
    },
  },
});
