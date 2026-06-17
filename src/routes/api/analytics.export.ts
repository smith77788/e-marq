/**
 * GET /api/analytics/export
 *
 * Експорт аналітичних даних у CSV.
 *
 * Query params:
 * - type: revenue | customers | products
 * - tenant_id
 * - start: ISO date
 * - end: ISO date
 *
 * Auth: Bearer JWT (Authorization header).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { exportRevenueReport, exportCustomerReport, exportProductReport } from "@/lib/acos/analyticsExport";

export const Route = createFileRoute("/api/analytics/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnon = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !supabaseAnon) {
          return Response.json({ error: "Server not configured" }, { status: 500 });
        }

        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        if (!token) return Response.json({ error: "Missing bearer token" }, { status: 401 });

        const userClient = createClient<Database>(supabaseUrl, supabaseAnon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) {
          return Response.json({ error: "Invalid token" }, { status: 401 });
        }
        const userId = claims.claims.sub as string;

        const url = new URL(request.url);
        const type = url.searchParams.get("type") ?? "revenue";
        const tenantId = url.searchParams.get("tenant_id") ?? "";
        const start = url.searchParams.get("start") ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        const end = url.searchParams.get("end") ?? new Date().toISOString();

        if (!tenantId) return Response.json({ error: "tenant_id required" }, { status: 400 });

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
        if (!membership && !superAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

        try {
          let csv = "";
          let filename = "";

          switch (type) {
            case "revenue":
              csv = await exportRevenueReport(tenantId, start, end);
              filename = `revenue-${start.split("T")[0]}-${end.split("T")[0]}.csv`;
              break;
            case "customers":
              csv = await exportCustomerReport(tenantId);
              filename = `customers-${new Date().toISOString().split("T")[0]}.csv`;
              break;
            case "products":
              csv = await exportProductReport(tenantId);
              filename = `products-${new Date().toISOString().split("T")[0]}.csv`;
              break;
            default:
              return Response.json({ error: "Invalid type. Use: revenue | customers | products" }, { status: 400 });
          }

          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Internal error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
