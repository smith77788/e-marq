/**
 * POST /api/analytics/smart
 *
 * Повертає повний аналітичний звіт для тенанта.
 * Використовується дашбордом власника.
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getKeyMetrics, generateInsights } from "@/lib/acos/analyticsEngine";
import { analyzeRevenueLeaks } from "@/lib/acos/revenueRecovery";
import { segmentCustomers } from "@/lib/acos/customerSegmentation";
import { predictCustomerLtv } from "@/lib/acos/clvPredictor";
import { analyzeFunnel } from "@/lib/acos/conversionOptimizer";
import { getUpsellOffers } from "@/lib/acos/upsellEngine";
import { getActivePromotions } from "@/lib/acos/promotionEngine";
import { getLoyaltyStats } from "@/lib/acos/loyaltyProgram";

export const Route = createFileRoute("/api/analytics/smart")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { tenant_id?: string };
        try {
          body = (await request.json()) as { tenant_id?: string };
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        const tenantId = body.tenant_id;
        if (!tenantId) {
          return Response.json({ ok: false, error: "tenant_id required" }, { status: 400 });
        }

        try {
          const [metrics, leaks, segments, clv, funnel, promotions, loyalty] = await Promise.all([
            getKeyMetrics(tenantId),
            analyzeRevenueLeaks(tenantId),
            segmentCustomers(tenantId),
            predictCustomerLtv(tenantId),
            analyzeFunnel(tenantId),
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
              promotions,
              loyalty,
            },
          });
        } catch (err) {
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "Internal error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
