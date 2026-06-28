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
import { clientIp, createIpRateLimiter } from "@/lib/http/rateLimit";

const callbackLimiter = createIpRateLimiter({ limit: 30 });

/** PII fields that must never appear in logs or the callbacks audit table. */
const PII_FIELDS = new Set([
  "customer_email", "customer_name", "sender_email", "sender_phone",
  "sender_first_name", "sender_last_name", "sender_address",
  "card_token", "card_mask2", "card_pan",
  "payment_ref", "private_key", "liqpay_private_key",
  "client_email", "client_name",
]);

function redactParsed(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    redacted[k] = PII_FIELDS.has(k) ? "[REDACTED]" : v;
  }
  return redacted;
}

/** Strip the `data` param from a LiqPay form-urlencoded rawBody (may contain customer PII). */
function redactRawBody(rawBody: string): string {
  // rawBody = "data=<base64>&signature=<sig>" — the base64 blob decodes to a
  // JSON object that can include sender_email, sender_phone, etc.
  // We keep only the signature field so the audit row stays useful but PII-free.
  try {
    const params = new URLSearchParams(rawBody);
    const out = new URLSearchParams();
    if (params.has("signature")) out.set("signature", params.get("signature")!);
    out.set("data", "[REDACTED]");
    return out.toString();
  } catch {
    return "[REDACTED]";
  }
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
  try {
    await supabaseAdmin.from("payment_callbacks_log").insert({
      provider: args.provider,
      order_id: args.orderId ?? null,
      tenant_id: args.tenantId ?? null,
      external_id: args.externalId ?? null,
      signature_valid: args.signatureValid,
      raw_body: redactRawBody(args.rawBody).slice(0, 8000),
      parsed_payload: (redactParsed(args.parsed) ?? {}) as never,
      http_status: args.httpStatus,
      ip: args.ip,
    });
  } catch (e) {
    console.error("[liqpay-callback] logCallback failed:", e instanceof Error ? e.message : e);
  }
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

        if (isLiqPaySuccess(parsed.status, gw.liqpay_sandbox)) {
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
        if (failErr) {
          // Recording the failure failed — return 500 so LiqPay retries instead
          // of believing the callback was handled and dropping the payment state.
          await logCallback({
            provider: "liqpay",
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
