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

import { clientIp, originUrl, createIpRateLimiter } from "@/lib/http/rateLimit";

const limiter = createIpRateLimiter({ limit: 10 });

export const Route = createFileRoute("/api/public/payments/monobank-init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!limiter.check(ip)) {
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }

        let body: { orderId?: unknown; accessToken?: unknown };
        try {
          body = (await request.json()) as { orderId?: unknown; accessToken?: unknown };
        } catch {
          return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
        }
        const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
        const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
          return Response.json({ ok: false, error: "invalid_order_id" }, { status: 400 });
        }
        if (!/^[0-9a-f-]{36}$/i.test(accessToken)) {
          return Response.json({ ok: false, error: "invalid_access_token" }, { status: 400 });
        }

        // Verify access_token to prevent IDOR on payment init
        const { data: order } = await supabaseAdmin
          .from("orders")
          .select("id, tenant_id, total_cents, currency, status")
          .eq("id", orderId)
          .eq("access_token", accessToken)
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

        // Idempotency: check for a recent pending intent before calling Mono API.
        // Monobank creates a real invoice on each call, so we must avoid duplicate calls.
        const { data: existingIntent } = await supabaseAdmin
          .from("payment_intents")
          .select("id, redirect_url")
          .eq("order_id", order.id)
          .eq("provider", "monobank")
          .eq("status", "pending")
          .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingIntent?.redirect_url) {
          // Return cached invoice URL — no new Mono API call needed
          return Response.json({
            ok: true,
            provider: "monobank",
            redirectUrl: existingIntent.redirect_url,
            intentId: existingIntent.id,
          });
        }

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

        const { data: intentResult, error: intentErr } = await supabaseAdmin.rpc(
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
          // Invoice already created at Monobank but no intent recorded —
          // return error to prevent duplicate invoice on retry
          return Response.json(
            { ok: false, error: "payment_intent_creation_failed" },
            { status: 500 },
          );
        }

        const intentId = (intentResult as { intent_id?: string } | null)?.intent_id ?? null;

        // Зберегти invoice_id у external_id intent'а одразу. Якщо це не вдасться,
        // callback не зможе знайти intent за invoiceId і впаде на
        // parsed.reference (контрольований відправником) — тому фейлимо явно.
        if (intentId) {
          const { error: extErr } = await supabaseAdmin
            .from("payment_intents")
            .update({ external_id: result.invoiceId })
            .eq("id", intentId);
          if (extErr) {
            console.error("[monobank-init] failed to save external_id:", extErr.message);
            return Response.json(
              { ok: false, error: "payment_intent_link_failed" },
              { status: 500 },
            );
          }
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
