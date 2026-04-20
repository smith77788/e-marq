/**
 * Cron entrypoint: iterate all active tenants and trigger run-all orchestrator
 * for each. Authenticated by SUPABASE_PUBLISHABLE_KEY (cron) or super_admin JWT.
 *
 * Used by pg_cron (daily 07:00 UTC) and manual super-admin trigger.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";

export const Route = createFileRoute("/hooks/agents/cron-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        // Authorize: cron uses publishable key, manual uses super_admin JWT
        let authed: "cron" | "super_admin" | null = null;
        if (token && token === process.env.SUPABASE_PUBLISHABLE_KEY) {
          authed = "cron";
        } else if (token) {
          const url = process.env.SUPABASE_URL;
          const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (url && anon) {
            const sb = createClient<Database>(url, anon, {
              global: { headers: { Authorization: `Bearer ${token}` } },
              auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
            });
            const { data } = await sb.auth.getClaims(token);
            const sub = data?.claims?.sub;
            if (sub) {
              const { data: roleRows } = await supabaseAdmin
                .from("user_roles")
                .select("role")
                .eq("user_id", sub)
                .eq("role", "super_admin");
              if ((roleRows ?? []).length > 0) authed = "super_admin";
            }
          }
        }
        if (!authed) return jsonError("Unauthorized", 401);

        const { data: tenants, error } = await supabaseAdmin
          .from("tenants")
          .select("id, slug, name")
          .eq("status", "active")
          .limit(500);
        if (error) return jsonError("Failed to list tenants", 500, { details: error.message });

        const origin = new URL(request.url).origin;
        const cronToken = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

        const started = Date.now();
        const results = await Promise.allSettled(
          (tenants ?? []).map(async (t) => {
            const res = await fetch(`${origin}/hooks/agents/run-all`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronToken}` },
              body: JSON.stringify({ tenant_id: t.id }),
            });
            const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            return { tenant: t.slug, ok: res.ok, ...body };
          }),
        );

        const summary = results.map((r, i) =>
          r.status === "fulfilled"
            ? r.value
            : { tenant: tenants?.[i]?.slug, ok: false, error: String(r.reason) },
        );
        const totalCreated = summary.reduce((s, r) => {
          const v = (r as Record<string, unknown>).insights_created;
          return s + (typeof v === "number" ? v : 0);
        }, 0);

        return jsonOk({
          tenants_processed: tenants?.length ?? 0,
          total_insights_created: totalCreated,
          duration_ms: Date.now() - started,
          triggered_by: authed,
          results: summary,
        });
      },
    },
  },
});
