/**
 * POST /api/public/payments/monobank-callback
 *
 * Monobank надсилає JSON з полями invoiceId та status. Підпис — ECDSA через
 * /api/merchant/pubkey, але для простоти ми перевіряємо статус через
 * GET /api/merchant/invoice/status (це гарантує що замовлення дійсно оплачене).
 *
 * Body: JSON { invoiceId, status, ... }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getMonoInvoiceStatus,
  isMonoSuccess,
  monoCcyMatchesOrderCurrency,
} from "@/lib/payments/monobank.server";
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
    provider: "monobank",
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

export const Route = createFileRoute("/api/public/payments/monobank-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const rawBody = await request.text();

        let parsed: { invoiceId?: string; reference?: string; status?: string };
        try {
          parsed = JSON.parse(rawBody) as typeof parsed;
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

        const invoiceId = String(parsed.invoiceId || "").trim();
        if (!invoiceId) {
          await logCallback({
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 400,
            ip,
          });
          return new Response("missing_invoice", { status: 400 });
        }

        // Find intent by external_id (we saved invoiceId)
        const { data: intent } = await supabaseAdmin
          .from("payment_intents")
          .select("order_id, tenant_id, amount_cents")
          .eq("provider", "monobank")
          .eq("external_id", invoiceId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const orderId = intent?.order_id || (parsed.reference ? String(parsed.reference) : null);
        if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) {
          await logCallback({
            signatureValid: false,
            externalId: invoiceId,
            rawBody,
            parsed,
            httpStatus: 404,
            ip,
          });
          return new Response("order_not_found", { status: 404 });
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
            externalId: invoiceId,
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
        if (!gw.monobank_token) {
          await logCallback({
            orderId,
            tenantId: order.tenant_id,
            externalId: invoiceId,
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 503,
            ip,
          });
          return new Response("not_configured", { status: 503 });
        }

        // Verify by fetching authoritative status
        const status = await getMonoInvoiceStatus(gw.monobank_token, invoiceId);
        if (!status) {
          await logCallback({
            orderId,
            tenantId: order.tenant_id,
            externalId: invoiceId,
            signatureValid: false,
            rawBody,
            parsed,
            httpStatus: 502,
            ip,
          });
          return new Response("status_check_failed", { status: 502 });
        }

        const enriched = { ...parsed, verified_status: status };

        // Привязка invoice↔order. Якщо intent не знайдено, orderId прийшов з
        // керованого відправником parsed.reference — тоді вимагаємо, щоб
        // reference з авторитетної відповіді API збігався з orderId. Інакше
        // оплачений invoice замовлення A можна "застосувати" до замовлення B
        // з тією ж сумою.
        if (!intent && status.reference !== orderId) {
          await logCallback({
            orderId,
            tenantId: order.tenant_id,
            externalId: invoiceId,
            signatureValid: false,
            rawBody,
            parsed: { ...enriched, error: "reference_mismatch" },
            httpStatus: 401,
            ip,
          });
          return new Response("reference_mismatch", { status: 401 });
        }

        // Валюта invoice'а має збігатися з валютою замовлення:
        // amount-guard у RPC порівнює лише числа, 2000 USD != 2000 UAH.
        if (!monoCcyMatchesOrderCurrency(status.ccy, order.currency)) {
          await logCallback({
            orderId,
            tenantId: order.tenant_id,
            externalId: invoiceId,
            signatureValid: true,
            rawBody,
            parsed: { ...enriched, error: "currency_mismatch" },
            httpStatus: 400,
            ip,
          });
          return new Response("currency_mismatch", { status: 400 });
        }

        if (isMonoSuccess(status.status)) {
          const { error: rpcErr } = await supabaseAdmin.rpc("mark_order_paid_by_gateway", {
            _order_id: orderId,
            _provider: "monobank",
            _external_id: invoiceId,
            _amount_cents: status.amount,
            _payload: enriched as never,
          });
          if (rpcErr) {
            await logCallback({
              orderId,
              tenantId: order.tenant_id,
              externalId: invoiceId,
              signatureValid: true,
              rawBody,
              parsed: { ...enriched, error: rpcErr.message },
              httpStatus: 500,
              ip,
            });
            return new Response("rpc_failed", { status: 500 });
          }
        } else if (
          status.status === "failure" ||
          status.status === "expired" ||
          status.status === "reversed"
        ) {
          const { error: failErr } = await supabaseAdmin.rpc("mark_payment_failed", {
            _order_id: orderId,
            _provider: "monobank",
            _external_id: invoiceId,
            _error: `${status.status}: ${status.failureReason ?? ""}`,
            _payload: enriched as never,
          });
          if (failErr) {
            // Recording the failure failed — return 500 so Monobank retries the
            // webhook instead of treating the payment state as resolved.
            await logCallback({
              orderId,
              tenantId: order.tenant_id,
              externalId: invoiceId,
              signatureValid: true,
              rawBody,
              parsed: { ...enriched, error: failErr.message },
              httpStatus: 500,
              ip,
            });
            return new Response("rpc_failed", { status: 500 });
          }
        }

        await logCallback({
          orderId,
          tenantId: order.tenant_id,
          externalId: invoiceId,
          signatureValid: true,
          rawBody,
          parsed: enriched,
          httpStatus: 200,
          ip,
        });
        return new Response("ok", { status: 200 });
      },
    },
  },
});
