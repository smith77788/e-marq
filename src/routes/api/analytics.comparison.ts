/**
 * POST /api/analytics/comparison — порівняння метрик за два різні періоди.
 *
 * Body: { tenantId, currentStart, currentEnd, previousStart, previousEnd }
 * Returns: { ok, comparison: ComparisonResult[] }
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { comparePeriods } from "@/lib/acos/analyticsComparison";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

const Body = z.object({
  tenantId: z.string().uuid(),
  currentStart: z.string().datetime(),
  currentEnd: z.string().datetime(),
  previousStart: z.string().datetime(),
  previousEnd: z.string().datetime(),
});

export const Route = createFileRoute("/api/analytics/comparison" as never)({
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

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON");
        }

        const parsed = Body.safeParse(body);
        if (!parsed.success) {
          return err(JSON.stringify(parsed.error.flatten().fieldErrors), 400);
        }

        const { tenantId, currentStart, currentEnd, previousStart, previousEnd } = parsed.data;

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

        const comparison = await comparePeriods(
          tenantId,
          currentStart,
          currentEnd,
          previousStart,
          previousEnd,
        );
        return Response.json({ ok: true, comparison });
      },
    },
  },
});
