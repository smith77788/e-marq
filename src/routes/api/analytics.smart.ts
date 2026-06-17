/**
 * POST /api/analytics/smart
 *
 * Повертає повний аналітичний звіт для тенанта.
 * Використовується дашбордом власника.
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { getKeyMetrics, generateInsights } from "@/lib/acos/analyticsEngine";
import { analyzeRevenueLeaks } from "@/lib/acos/revenueRecovery";
import { segmentCustomers } from "@/lib/acos/customerSegmentation";
import { predictCustomerLtv } from "@/lib/acos/clvPredictor";
import { analyzeFunnel } from "@/lib/acos/conversionOptimizer";
import { getUpsellOffers } from "@/lib/acos/upsellEngine";
import { getActivePromotions } from "@/lib/acos/promotionEngine";
import { getLoyaltyStats } from "@/lib/acos/loyaltyProgram";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

export const Route = createFileRoute("/api/analytics/smart")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnon = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !supabaseAnon) return err("Server not configured", 500);

        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        if (!token) return err("Missing bearer token", 401);

        const userClient = createClient<Database>(supabaseUrl, supabaseAnon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) return err("Invalid token", 401);
        const userId = claims.claims.sub as string;

        let body: { tenant_id?: string };
        try {
          body = (await request.json()) as { tenant_id?: string };
        } catch {
          return err("Invalid JSON");
        }

        const tenantId = (body.tenant_id ?? "").trim();
        if (!tenantId) return err("tenant_id required");

        // Verify user has access to this tenant
        const { data: membership } = await supabaseAdmin
          .from("tenant_memberships")
          .select("role")
          .eq("user_id", userId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        const { data: superAdmin } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .maybeSingle();
        if (!membership && !superAdmin) return err("Forbidden", 403);

        try {
          const [metrics, leaks, segments, clv, funnel, upsells, promotions, loyalty] = await Promise.all([
            getKeyMetrics(tenantId),
            analyzeRevenueLeaks(tenantId),
            segmentCustomers(tenantId),
            predictCustomerLtv(tenantId),
            analyzeFunnel(tenantId),
            getUpsellOffers(tenantId),
            getActivePromotions(tenantId),
            getLoyaltyStats(tenantId),
          ]);

          const insights = await generateInsights(tenantId);

          return Response.json({
            ok: true,
            data: {
              metrics,
              insights,
              leaks: leaks.leaks,
              segments: segments.segments,
              topCustomers: clv.slice(0, 10),
              funnel,
              upsells,
              promotions,
              loyalty,
            },
          });
        } catch (e) {
          return err(e instanceof Error ? e.message : "Internal error", 500);
        }
      },
    },
  },
});
