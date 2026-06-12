/**
 * POST /hooks/agents/self-heal-engine
 *
 * Run a full self-heal cycle: detectors → incidents → safe auto-apply.
 * Auth: cron token OR super-admin JWT. Tenant-scoped if `tenant_id` provided.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { isCronToken } from "@/lib/acos/cronAuth";
import { runSelfHealCycle } from "@/lib/self-heal/engine";

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function jsonOk(payload: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...((payload as object) ?? {}) }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function isSuperAdmin(token: string): Promise<{ userId: string } | null> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return null;
  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  const userId = data.claims.sub as string;
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin");
  return roles && roles.length > 0 ? { userId } : null;
}

export const Route = createFileRoute("/hooks/agents/self-heal-engine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token) return jsonError("Missing bearer token", 401);

        let tenantId: string | null = null;
        try {
          const body = (await request.json().catch(() => ({}))) as { tenant_id?: string };
          tenantId = body.tenant_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }

        if (!isCronToken(token)) {
          const sa = await isSuperAdmin(token);
          if (!sa) return jsonError("Forbidden: super-admin required", 403);
        }

        try {
          const summary = await runSelfHealCycle(tenantId);
          return jsonOk({ summary });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[self-heal-engine] cycle failed:", message);
          return jsonError(`cycle_failed: ${message}`, 500);
        }
      },
      GET: async () => jsonOk({ hint: "POST to run a self-heal cycle" }),
    },
  },
});
