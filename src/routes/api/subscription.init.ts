/**
 * POST /api/subscription/init
 *
 * Creates a subscription payment intent for plan upgrades.
 * Returns payment details for gateway redirect.
 *
 * Body: { tenantId: string, planKey: string, provider?: string }
 * Returns: { ok: true, ... } | { ok: false, error: string }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readGatewayConfig } from "@/lib/payments/types";
import { buildLiqPayCheckout } from "@/lib/payments/liqpay.server";
import { clientIp, originUrl, createIpRateLimiter } from "@/lib/http/rateLimit";

const limiter = createIpRateLimiter({ limit: 10 });

export const Route = createFileRoute("/api/subscription/init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!limiter.check(ip)) {
          return Response.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 });
        }

        let body: { tenantId?: string; planKey?: string; provider?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        const { tenantId, planKey, provider = "liqpay" } = body;
        if (!tenantId || !planKey) {
          return Response.json({ ok: false, error: "Missing tenantId or planKey" }, { status: 400 });
        }

        // Create payment intent via RPC
        const { data: paymentData, error: rpcError } = await supabaseAdmin.rpc(
          "create_subscription_payment",
          {
            _tenant_id: tenantId,
            _plan_key: planKey,
            _provider: provider,
          },
        );

        if (rpcError) {
          return Response.json({ ok: false, error: rpcError.message }, { status: 400 });
        }

        const payment = paymentData as {
          payment_id: string;
          provider_order_id: string;
          amount_cents: number;
          currency: string;
          plan_name: string;
          plan_key: string;
        };

        // Get tenant config for payment gateway
        const { data: tenantConfig, error: configError } = await supabaseAdmin
          .from("tenant_configs")
          .select("features")
          .eq("tenant_id", tenantId)
          .single();

        if (configError || !tenantConfig) {
          return Response.json({ ok: false, error: "Tenant config not found" }, { status: 404 });
        }

        const gateway = readGatewayConfig(tenantConfig.features);
        const baseUrl = originUrl(request);
        const resultUrl = `${baseUrl}/brand/billing?tenant=${tenantId}&payment=success`;
        const serverUrl = `${baseUrl}/api/subscription/callback`;

        // Build gateway-specific redirect/form data
        if (provider === "liqpay" && gateway.liqpay_enabled) {
          const checkout = buildLiqPayCheckout({
            publicKey: gateway.liqpay_public_key,
            privateKey: gateway.liqpay_private_key,
            amount: payment.amount_cents / 100,
            currency: payment.currency,
            description: `MARQ ${payment.plan_name} — підписка`,
            orderId: payment.provider_order_id,
            resultUrl,
            serverUrl,
            sandbox: gateway.liqpay_sandbox,
          });

          return Response.json({
            ok: true,
            provider: "liqpay",
            intentId: payment.payment_id,
            formFields: { data: checkout.data, signature: checkout.signature },
            formAction: checkout.checkoutUrl,
          });
        }

        return Response.json({ ok: false, error: `Provider ${provider} not configured` }, { status: 400 });
      },
    },
  },
});
