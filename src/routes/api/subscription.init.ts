/**
 * POST /api/subscription/init
 *
 * Creates a subscription payment session and returns LiqPay checkout data.
 * Stores the pending session in bootstrap_facts (no subscription_payments table exists).
 *
 * Body: { tenantId: string, planKey: string, provider?: string }
 * Returns: { ok: true, ... } | { ok: false, error: string }
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
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

        // Look up the plan by key
        const { data: plan, error: planError } = await supabaseAdmin
          .from("plans")
          .select("id, name, key, price_cents_monthly, currency")
          .eq("key", planKey)
          .eq("is_active", true)
          .single();

        if (planError || !plan) {
          return Response.json({ ok: false, error: "Plan not found" }, { status: 404 });
        }

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

        // Create a unique order ID for this payment session
        const providerOrderId = `sub_${tenantId.slice(0, 8)}_${Date.now()}`;
        const paymentId = crypto.randomUUID();

        // Store pending payment session in bootstrap_facts
        const { error: sessionError } = await supabaseAdmin
          .from("bootstrap_facts")
          .insert({
            fact_key: `payment_session_${paymentId}`,
            fact_kind: "payment_session",
            tenant_id: tenantId,
            confidence: 1.0,
            source: "subscription_init",
            value: {
              payment_id: paymentId,
              provider_order_id: providerOrderId,
              plan_id: plan.id,
              plan_key: plan.key,
              plan_name: plan.name,
              amount_cents: plan.price_cents_monthly,
              currency: plan.currency,
              provider,
              status: "pending",
              created_at: new Date().toISOString(),
            } as never,
          });

        if (sessionError) {
          return Response.json({ ok: false, error: "Failed to create payment session" }, { status: 500 });
        }

        const resultUrl = `${baseUrl}/brand/billing?tenant=${tenantId}&payment=success`;
        const serverUrl = `${baseUrl}/api/subscription/callback`;

        if (provider === "liqpay" && gateway.liqpay_enabled) {
          const checkout = buildLiqPayCheckout({
            publicKey: gateway.liqpay_public_key,
            privateKey: gateway.liqpay_private_key,
            amount: plan.price_cents_monthly / 100,
            currency: plan.currency,
            description: `MARQ ${plan.name} — підписка`,
            orderId: providerOrderId,
            resultUrl,
            serverUrl,
            sandbox: gateway.liqpay_sandbox,
          });

          return Response.json({
            ok: true,
            provider: "liqpay",
            intentId: paymentId,
            formFields: { data: checkout.data, signature: checkout.signature },
            formAction: checkout.checkoutUrl,
          });
        }

        return Response.json({ ok: false, error: `Provider ${provider} not configured` }, { status: 400 });
      },
    },
  },
});
