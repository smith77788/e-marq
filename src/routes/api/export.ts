/**
 * GET /api/export?tenantId=xxx&type=revenue|customers|products — export data as CSV
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exportRevenue, exportCustomers, exportProducts } from "@/lib/acos/exportSystem";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

async function resolveAuth(
  request: Request,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
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
  const { data: sa } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (sa) return { ok: true };
  const { data: m } = await supabaseAdmin.from("tenant_memberships").select("role").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (!m) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export const Route = createFileRoute("/api/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const tenantId = u.searchParams.get("tenantId") ?? "";
        const type = u.searchParams.get("type") ?? "";
        if (!tenantId) return err("tenantId required");
        if (!type) return err("type required (revenue|customers|products)");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        if (type === "revenue") {
          const { data: orders } = await supabaseAdmin
            .from("orders")
            .select("created_at, total_cents")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false })
            .limit(1000);

          // Aggregate by date
          const byDate: Record<string, { revenue: number; orders: number }> = {};
          for (const o of orders ?? []) {
            const date = (o.created_at ?? "").slice(0, 10);
            if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0 };
            byDate[date].revenue += Math.round((o.total_cents ?? 0) / 100);
            byDate[date].orders += 1;
          }
          const rows = Object.entries(byDate).map(([date, v]) => ({ date, ...v }));
          const csv = await exportRevenue(rows);
          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="revenue-${tenantId}.csv"`,
            },
          });
        }

        if (type === "customers") {
          const { data: customers } = await supabaseAdmin
            .from("customers")
            .select("id, name, email, total_orders, total_spent_cents, updated_at")
            .eq("tenant_id", tenantId)
            .limit(5000);

          const rows = (customers ?? []).map((c) => ({
            id: c.id,
            name: c.name ?? "",
            email: c.email ?? "",
            total_orders: c.total_orders ?? 0,
            total_spent: Math.round((c.total_spent_cents ?? 0) / 100),
            last_order: (c.updated_at ?? "").slice(0, 10),
          }));
          const csv = await exportCustomers(rows);
          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="customers-${tenantId}.csv"`,
            },
          });
        }

        if (type === "products") {
          const { data: products } = await supabaseAdmin
            .from("products")
            .select("id, name, price_cents, stock")
            .eq("tenant_id", tenantId)
            .limit(5000);

          const rows = (products ?? []).map((p) => ({
            id: p.id,
            name: p.name ?? "",
            price: Math.round((p.price_cents ?? 0) / 100),
            stock: p.stock ?? 0,
            monthly_sales: 0,
          }));
          const csv = await exportProducts(rows);
          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="products-${tenantId}.csv"`,
            },
          });
        }

        return err(`Unknown type: ${type}. Use revenue, customers, or products.`);
      },
    },
  },
});
