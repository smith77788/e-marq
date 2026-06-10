/**
 * Cron entrypoint — runs sales bot for ALL active tenants.
 * Auth: bearer = SUPABASE_PUBLISHABLE_KEY (cron) OR a super_admin user JWT.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { runSalesBotForTenant } from "@/lib/acos/salesBot";
import { dispatchTenantOutbound } from "@/lib/acos/channels";
import type { Database } from "@/integrations/supabase/types";
import { isCronToken } from "@/lib/acos/cronAuth";

async function isAuthorized(token: string): Promise<boolean> {
  if (!token) return false;
  if (isCronToken(token)) return true;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return false;
  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data } = await sb.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (!userId) return false;
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin");
  return (roles ?? []).length > 0;
}

export const Route = createFileRoute("/hooks/agents/sales-bot-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!(await isAuthorized(token))) return jsonError("Unauthorized", 401);

        const { data: tenants, error } = await supabaseAdmin
          .from("tenants")
          .select("id, slug")
          .eq("status", "active")
          .limit(500);
        if (error) return jsonError("Failed to load tenants", 500, { details: error.message });

        const outcomes: Array<Record<string, unknown>> = [];
        for (const t of tenants ?? []) {
          try {
            const result = await runSalesBotForTenant(t.id, 20);
            const dispatch = await dispatchTenantOutbound(t.id, 100);
            outcomes.push({ tenant_id: t.id, slug: t.slug, ...result, ...dispatch });
          } catch (err) {
            outcomes.push({
              tenant_id: t.id,
              slug: t.slug,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return jsonOk({ tenants_processed: outcomes.length, outcomes });
      },
    },
  },
});
