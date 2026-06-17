/**
 * POST /api/analytics/dashboard
 *
 * Повертає повний дашборд з віджетами, insights та графіками.
 * Використовується головною сторінкою власника.
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { getDashboardWidgets } from "@/lib/acos/dashboardWidgets";
import { generateAnalyticsInsights } from "@/lib/acos/analyticsInsights";
import { getRevenueChartData, getCustomerGrowthChartData, getTopProductsChartData } from "@/lib/acos/analyticsCharts";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

export const Route = createFileRoute("/api/analytics/dashboard")({
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
        } catch (e) {
          return err(e instanceof Error ? e.message : "Internal error", 500);
        }
      },
    },
  },
});
