/**
 * POST /api/public/payments/liqpay-callback
 *
 * Webhook від LiqPay: form-urlencoded { data, signature }.
 * Перевіряємо підпис private_key'ом тенанта (визначаємо тенанта за orderId).
 *
 * При success → mark_order_paid_by_gateway RPC.
 * Завжди логуємо в payment_callbacks_log.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  parseLiqPayCallback,
  verifyLiqPaySignature,
  isLiqPaySuccess,
} from "@/lib/payments/liqpay.server";
import { readGatewayConfig } from "@/lib/payments/types";

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function logCallback(args: {
  provider: string;
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
    provider: args.provider,
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

export const Route = createFileRoute("/api/public/payments/liqpay-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const rawBody = await request.text();

        // LiqPay sends application/x-www-form-urlencoded with `data` & `signature`
        const params = new URLSearchParams(rawBody);
        const data = params.get("data") ?? "";
        const signature = params.get("signature") ?? "";

        if (!data || !signature) {
          await logCallback({
            provider: "liqpay",
            signatureValid: false,
            rawBody,
            parsed: { error: "missing_fields" },
            httpStatus: 400,
            ip,
          });
          return new Response("missing_fields", { status: 400 });
        }

        let parsed;
        try {
          parsed = parseLiqPayCallback(data);
        } catch {
          await logCallback({
            provider: "liqpay",
            signatureValid: false,
            rawBody,
            parsed: { error: "bad_data" },
            httpStatus: 400,
            ip,
          });
          return new Response("bad_data", { status: 400 });
        }

        const orderId = String(parsed.order_id || "").trim();
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
          await logCallback({
            provider: "liqpay",
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 400,
            ip,
          });
          return new Response("invalid_order", { status: 400 });
        }

        // Find tenant by order
        const { data: order } = await supabaseAdmin
          .from("orders")
          .select("id, tenant_id, total_cents, currency")
          .eq("id", orderId)
          .maybeSingle();
        if (!order) {
          await logCallback({
            provider: "liqpay",
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
        if (!gw.liqpay_private_key) {
          await logCallback({
            provider: "liqpay",
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

        const valid = verifyLiqPaySignature(gw.liqpay_private_key, data, signature);
        if (!valid) {
          await logCallback({
            provider: "liqpay",
            orderId,
            tenantId: order.tenant_id,
            externalId: String(parsed.transaction_id || ""),
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 401,
            ip,
          });
          return new Response("invalid_signature", { status: 401 });
        }

        const externalId = String(parsed.transaction_id || parsed.payment_id || "");
        const amountCents = Math.round(Number(parsed.amount) * 100);

        // Валюта callback'а має збігатися з валютою замовлення:
        // amount-guard у RPC порівнює лише числа, 2000 USD != 2000 UAH.
        const orderCurrency = (order.currency || "UAH").toUpperCase();
        if (String(parsed.currency || "").toUpperCase() !== orderCurrency) {
          await logCallback({
            provider: "liqpay",
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

        if (isLiqPaySuccess(parsed.status)) {
          const { error: rpcErr } = await supabaseAdmin.rpc("mark_order_paid_by_gateway", {
            _order_id: orderId,
            _provider: "liqpay",
            _external_id: externalId,
            _amount_cents: amountCents,
            _payload: parsed as never,
          });
          if (rpcErr) {
            await logCallback({
              provider: "liqpay",
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
          await logCallback({
            provider: "liqpay",
            orderId,
            tenantId: order.tenant_id,
            externalId,
            signatureValid: true,
            rawBody,
            parsed,
            httpStatus: 200,
            ip,
          });
          return new Response("ok", { status: 200 });
        }

        // Failure / other
        const { error: failErr } = await supabaseAdmin.rpc("mark_payment_failed", {
          _order_id: orderId,
          _provider: "liqpay",
          _external_id: externalId,
          _error: `${parsed.status}: ${parsed.err_description || parsed.err_code || ""}`,
          _payload: parsed as never,
        });
        if (failErr) console.error("[liqpay-callback] mark_payment_failed:", failErr.message);
        await logCallback({
          provider: "liqpay",
          orderId,
          tenantId: order.tenant_id,
          externalId,
          signatureValid: true,
          rawBody,
          parsed,
          httpStatus: 200,
          ip,
        });
        return new Response("ok", { status: 200 });
      },
    },
  },
});
