/**
 * POST /api/analytics/dashboard
 *
 * Повертає повний дашборд з віджетами, insights та графіками.
 * Використовується головною сторінкою власника.
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getDashboardWidgets } from "@/lib/acos/dashboardWidgets";
import { generateAnalyticsInsights } from "@/lib/acos/analyticsInsights";
import { getRevenueChartData, getCustomerGrowthChartData, getTopProductsChartData } from "@/lib/acos/analyticsCharts";
import { getCartRecommendations } from "@/lib/acos/cartOptimizer";
import { getSearchSuggestions } from "@/lib/acos/searchOptimizer";

export const Route = createFileRoute("/api/analytics/dashboard")({
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
          const [widgets, insights, revenueChart, customerChart, topProducts] = await Promise.all([
            getDashboardWidgets(tenantId),
            generateAnalyticsInsights(tenantId),
            getRevenueChartData(tenantId),
            getCustomerGrowthChartData(tenantId),
            getTopProductsChartData(tenantId),
          ]);

          return Response.json({
            ok: true,
            data: {
              widgets,
              insights,
              charts: {
                revenue: revenueChart,
                customers: customerChart,
                topProducts,
              },
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
