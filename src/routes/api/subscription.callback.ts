/**
 * POST /api/subscription/callback
 *
 * Payment callback endpoint for subscription payments.
 * Receives webhook from LiqPay/WayForPay/Monobank and activates subscription.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyLiqPaySignature, parseLiqPayCallback, isLiqPaySuccess } from "@/lib/payments/liqpay.server";

export const Route = createFileRoute("/api/subscription/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") || "";

        // LiqPay sends base64-encoded data + signature
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const formData = await request.formData();
          const data = formData.get("data") as string;
          const signature = formData.get("signature") as string;

          if (!data || !signature) {
            return Response.json({ error: "Missing data or signature" }, { status: 400 });
          }

          // Parse callback payload
          const callbackPayload = parseLiqPayCallback(data);
          const providerOrderId = callbackPayload.order_id;

          // Find payment record
          const { data: payment, error: findError } = await supabaseAdmin
            .from("subscription_payments")
            .select("*, tenant_subscriptions!inner(tenant_id)")
            .eq("provider_order_id", providerOrderId)
            .eq("provider", "liqpay")
            .eq("status", "pending")
            .single();

          if (findError || !payment) {
            return Response.json({ error: "Payment not found" }, { status: 404 });
          }

          // Get tenant's LiqPay config for signature verification
          const { data: tenantConfig } = await supabaseAdmin
            .from("tenant_configs")
            .select("features")
            .eq("tenant_id", payment.tenant_subscriptions.tenant_id)
            .single();

          const features = tenantConfig?.features as Record<string, unknown> | null;
          const payments = (features?.payments ?? {}) as Record<string, unknown>;
          const liqpayPrivateKey = payments.liqpay_private_key as string;

          if (!liqpayPrivateKey) {
            return Response.json({ error: "LiqPay not configured" }, { status: 500 });
          }

          // Verify signature
          if (!verifyLiqPaySignature(liqpayPrivateKey, data, signature)) {
            return Response.json({ error: "Invalid signature" }, { status: 403 });
          }

          // Check success status
          const allowSandbox = payments.liqpay_sandbox === true;
          if (!isLiqPaySuccess(callbackPayload.status, allowSandbox)) {
            // Mark as failed
            await supabaseAdmin
              .from("subscription_payments")
              .update({ status: "failed", metadata: { error: callbackPayload.status } })
              .eq("id", payment.id);

            return Response.json({ ok: true, status: "failed" });
          }

          // Complete the payment
          const { data: completed } = await supabaseAdmin.rpc("complete_subscription_payment", {
            _provider_order_id: providerOrderId,
            _provider: "liqpay",
            _provider_transaction_id: String(callbackPayload.transaction_id || ""),
          });

          return Response.json({ ok: true, completed: !!completed });
        }

        return Response.json({ error: "Unsupported content type" }, { status: 400 });
      },

      // Also handle GET for result_url redirects from LiqPay
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const orderId = url.searchParams.get("order_id");

        if (orderId) {
          // Redirect to billing page with success status
          return Response.redirect(`/brand/billing?payment=success&order=${orderId}`, 302);
        }

        return Response.redirect("/brand/billing", 302);
      },
    },
  },
});
