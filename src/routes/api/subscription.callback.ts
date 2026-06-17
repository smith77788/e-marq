/**
 * POST /api/subscription/callback
 *
 * Payment callback endpoint for LiqPay subscription payments.
 * Looks up the pending session in bootstrap_facts, verifies signature,
 * then activates the subscription in tenant_subscriptions.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyLiqPaySignature, parseLiqPayCallback, isLiqPaySuccess } from "@/lib/payments/liqpay.server";

export const Route = createFileRoute("/api/subscription/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") || "";

        if (!contentType.includes("application/x-www-form-urlencoded")) {
          return Response.json({ error: "Unsupported content type" }, { status: 400 });
        }

        const formData = await request.formData();
        const data = formData.get("data") as string;
        const signature = formData.get("signature") as string;

        if (!data || !signature) {
          return Response.json({ error: "Missing data or signature" }, { status: 400 });
        }

        const callbackPayload = parseLiqPayCallback(data);
        const providerOrderId = callbackPayload.order_id;

        // Find the pending payment session stored in bootstrap_facts
        const { data: sessions } = await supabaseAdmin
          .from("bootstrap_facts")
          .select("*")
          .eq("fact_kind", "payment_session")
          .limit(200);

        const sessionRow = (sessions ?? []).find((row) => {
          const v = (row.value ?? {}) as Record<string, unknown>;
          return v.provider_order_id === providerOrderId && v.status === "pending";
        });

        if (!sessionRow) {
          return Response.json({ error: "Payment session not found" }, { status: 404 });
        }

        const session = (sessionRow.value ?? {}) as Record<string, unknown>;
        const tenantId = sessionRow.tenant_id;

        // Get tenant's LiqPay config for signature verification
        const { data: tenantConfig } = await supabaseAdmin
          .from("tenant_configs")
          .select("features")
          .eq("tenant_id", tenantId)
          .single();

        const features = (tenantConfig?.features ?? {}) as Record<string, unknown>;
        const payments = (features.payments ?? {}) as Record<string, unknown>;
        const liqpayPrivateKey = payments.liqpay_private_key as string;

        if (!liqpayPrivateKey) {
          return Response.json({ error: "LiqPay not configured" }, { status: 500 });
        }

        if (!verifyLiqPaySignature(liqpayPrivateKey, data, signature)) {
          return Response.json({ error: "Invalid signature" }, { status: 403 });
        }

        const allowSandbox = payments.liqpay_sandbox === true;

        if (!isLiqPaySuccess(callbackPayload.status, allowSandbox)) {
          // Mark session as failed
          await supabaseAdmin
            .from("bootstrap_facts")
            .update({
              value: { ...session, status: "failed", failed_at: new Date().toISOString() } as never,
            })
            .eq("id", sessionRow.id);

          return Response.json({ ok: true, status: "failed" });
        }

        // Activate the subscription in tenant_subscriptions
        const planId = session.plan_id as string;
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        const { error: subError } = await supabaseAdmin
          .from("tenant_subscriptions")
          .upsert(
            {
              tenant_id: tenantId,
              plan_id: planId,
              status: "active",
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              cancel_at_period_end: false,
            },
            { onConflict: "tenant_id" },
          );

        if (subError) {
          return Response.json({ error: "Failed to activate subscription" }, { status: 500 });
        }

        // Mark session as completed
        await supabaseAdmin
          .from("bootstrap_facts")
          .update({
            value: {
              ...session,
              status: "completed",
              transaction_id: String(callbackPayload.transaction_id || ""),
              completed_at: new Date().toISOString(),
            } as never,
          })
          .eq("id", sessionRow.id);

        return Response.json({ ok: true, status: "completed" });
      },

      // Handle GET for result_url redirects from LiqPay
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const orderId = url.searchParams.get("order_id");

        if (orderId) {
          return Response.redirect(`/brand/billing?payment=success&order=${orderId}`, 302);
        }

        return Response.redirect("/brand/billing", 302);
      },
    },
  },
});
