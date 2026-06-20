/**
 * GET /api/inventory/optimize?tenantId=xxx — ABC analysis + inventory recommendations.
 *
 * Note: getInventoryRecommendations requires a products array with stock and avg_daily_sales.
 * Since that data isn't available server-side without an extra query, we fetch it from Supabase
 * and pass it through.
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  analyzeAbc,
  getInventoryRecommendations,
} from "@/lib/acos/inventoryOptimization";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

async function resolveAuth(
  request: Request,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "Server not configured" };

  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return { ok: false, status: 401, error: "Invalid token" };
  const userId = claims.claims.sub as string;

  const { data: sa } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (sa) return { ok: true };

  const { data: m } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!m) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export const Route = createFileRoute("/api/inventory/optimize")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const analysis = await analyzeAbc(tenantId);

        // Fetch product stock data to compute recommendations
        const { data: products } = await supabaseAdmin
          .from("products")
          .select("id, stock")
          .eq("tenant_id", tenantId)
          .limit(500);

        // avg_daily_sales is not stored directly — approximate from analysis revenue
        // Use a simple heuristic: products not in ABC analysis get 0 avg_daily_sales
        const abcRevenueMap = new Map(
          analysis.map((a) => [a.product_id, a.revenue_cents]),
        );
        const productList = (products ?? []).map((p) => ({
          id: p.id,
          stock: p.stock,
          avg_daily_sales: Math.max(
            0,
            Math.round((abcRevenueMap.get(p.id) ?? 0) / 100 / 30),
          ),
        }));

        const recommendations = getInventoryRecommendations(analysis, productList);
        return Response.json({ ok: true, analysis, recommendations });
      },
    },
  },
});
