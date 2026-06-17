/**
 * POST /api/subscription/callback
 *
 * Payment callback endpoint for LiqPay subscription payments.
 * Uses subscription_payments table and complete_subscription_payment RPC
 * defined in migration 20260617000001_subscription_payments.sql.
 *
 * NOTE: Types cast as never because supabase types haven't been regenerated
 * after the migration that added subscription_payments.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyLiqPaySignature, parseLiqPayCallback, isLiqPaySuccess } from "@/lib/payments/liqpay.server";

// Typed proxy for tables not yet in generated types
const db = supabaseAdmin as unknown as typeof supabaseAdmin;

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

        // Find the pending payment record
        const { data: payment, error: findError } = await db
          .from("subscription_payments" as never)
          .select("id, tenant_id, status" as never)
          .eq("provider_order_id" as never, providerOrderId)
          .eq("provider" as never, "liqpay")
          .eq("status" as never, "pending")
          .single() as unknown as {
            data: { id: string; tenant_id: string; status: string } | null;
            error: { message: string } | null;
          };

        if (findError || !payment) {
          return Response.json({ error: "Payment not found" }, { status: 404 });
        }

        // Get tenant's LiqPay config for signature verification
        const { data: tenantConfig } = await supabaseAdmin
          .from("tenant_configs")
          .select("features")
          .eq("tenant_id", payment.tenant_id)
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
          await db
            .from("subscription_payments" as never)
            .update({ status: "failed" } as never)
            .eq("id" as never, payment.id);

          return Response.json({ ok: true, status: "failed" });
        }

        // Complete the payment via RPC — activates subscription, logs plan change, grants credits
        const { data: completed } = await supabaseAdmin.rpc("complete_subscription_payment" as never, {
          _provider_order_id: providerOrderId,
          _provider: "liqpay",
          _provider_transaction_id: String(callbackPayload.transaction_id || ""),
        } as never);

        return Response.json({ ok: true, completed: !!completed });
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
