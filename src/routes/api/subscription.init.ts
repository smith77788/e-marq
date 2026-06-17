/**
 * POST /api/subscription/init
 *
 * Creates a subscription payment intent for plan upgrades.
 * Returns payment details for gateway redirect.
 *
 * Body: { tenantId: string, planKey: string, provider?: string }
 * Returns: { ok: true, ... } | { ok: false, error: string }
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 *
 * NOTE: subscription_payments table and create_subscription_payment RPC are defined in
 * migration 20260617000001_subscription_payments.sql. Supabase types haven't been
 * regenerated yet, hence the `as never` casts on the RPC call.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readGatewayConfig } from "@/lib/payments/types";
import { buildLiqPayCheckout } from "@/lib/payments/liqpay.server";
import { clientIp, originUrl, createIpRateLimiter } from "@/lib/http/rateLimit";

const limiter = createIpRateLimiter({ limit: 10 });

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  planKey: z.string().min(1).max(50),
  provider: z.enum(["liqpay", "wayforpay", "monobank"]).default("liqpay"),
});

async function authUser(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, status: 401, error: "missing_bearer" };
  const token = auth.slice(7).trim();
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "server_misconfigured" };
  const sb = createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { ok: false, status: 401, error: "invalid_token" };
  return { ok: true, userId: String(data.claims.sub) };
}

async function userCanManageTenant(userId: string, tenantId: string): Promise<boolean> {
  const { data: sa } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (sa) return true;
  const { data: m } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return m?.role === "owner" || m?.role === "admin";
}

export const Route = createFileRoute("/api/subscription/init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!limiter.check(ip)) {
          return Response.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 });
        }

        const auth = await authUser(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        const parsed = BodySchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ ok: false, error: parsed.error.flatten().fieldErrors }, { status: 400 });
        }

        const { tenantId, planKey, provider } = parsed.data;

        if (!(await userCanManageTenant(auth.userId, tenantId))) {
          return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
        }

        // Create payment intent via RPC (defined in 20260617000001_subscription_payments.sql)
        // Types cast as never because supabase types haven't been regenerated after the migration
        const { data: paymentData, error: rpcError } = await supabaseAdmin.rpc(
          "create_subscription_payment" as never,
          {
            _tenant_id: tenantId,
            _plan_key: planKey,
            _provider: provider,
          } as never,
        );

        if (rpcError) {
          return Response.json({ ok: false, error: rpcError.message }, { status: 400 });
        }

        const payment = paymentData as unknown as {
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
