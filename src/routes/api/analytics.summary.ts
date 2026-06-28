/**
 * POST /api/analytics/summary — зведення аналітики тенанта.
 *
 * Body: { tenant_id }
 * Returns: { ok, summary: AnalyticsSummary }
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAnalyticsSummary } from "@/lib/acos/analyticsSystem";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

export const Route = createFileRoute("/api/analytics/summary")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnon = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !supabaseAnon) return err("Server not configured", 500);

        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token) return err("Missing bearer token", 401);

        const sb = createClient<Database>(supabaseUrl, supabaseAnon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
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

        const { data: sa } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .maybeSingle();

        if (!sa) {
          const { data: m } = await supabaseAdmin
            .from("tenant_memberships")
            .select("role")
            .eq("user_id", userId)
            .eq("tenant_id", tenantId)
            .maybeSingle();
          if (!m) return err("Forbidden", 403);
        }

        const summary = await getAnalyticsSummary(tenantId);
        return Response.json({ ok: true, summary });
      },
    },
  },
});
