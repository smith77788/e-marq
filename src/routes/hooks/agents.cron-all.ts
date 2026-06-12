/**
 * Cron entrypoint: iterate all active tenants and trigger run-all orchestrator
 * for each. Authenticated by SUPABASE_PUBLISHABLE_KEY (cron) or super_admin JWT.
 *
 * Used by pg_cron (daily 07:00 UTC) and manual super-admin trigger.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FANOUT_TENANT_STATUSES } from "@/lib/acos/fanoutTenants";
import {
  AGENT_FANOUT_CONCURRENCY,
  RUN_ALL_CALL_TIMEOUT_MS,
  TENANT_FANOUT_CONCURRENCY,
  allSettledWithConcurrency,
  callHook,
  isTotalFailure,
} from "@/lib/acos/fanout";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { getInternalCronToken, isCronToken } from "@/lib/acos/cronAuth";

export const Route = createFileRoute("/hooks/agents/cron-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        // Authorize: cron uses publishable key, manual uses super_admin JWT
        let authed: "cron" | "super_admin" | null = null;
        if (token && isCronToken(token)) {
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
          .in("status", [...FANOUT_TENANT_STATUSES])
          .limit(500);
        if (error) return jsonError("Failed to list tenants", 500, { details: error.message });

        const origin = new URL(request.url).origin;
        const cronToken = getInternalCronToken();

        const started = Date.now();
        const results = await allSettledWithConcurrency(
          tenants ?? [],
          TENANT_FANOUT_CONCURRENCY,
          async (t) => {
            const call = await callHook(
              origin,
              "agents/run-all",
              cronToken,
              { tenant_id: t.id },
              RUN_ALL_CALL_TIMEOUT_MS,
            );
            return { tenant: t.slug, ok: call.ok, error: call.error, ...call.body };
          },
        );

        // Платформенні (multi-tenant) агенти-генератори лідів — запускаємо
        // ОДИН раз на цикл, незалежно від тенантів. Вони працюють з
        // public.lead_prospects/lead_outreach/lead_magnets.
        const PLATFORM_LEAD_AGENTS = ["web-prospector", "social-engager", "content-magnet"];
        const platformResults = await allSettledWithConcurrency(
          PLATFORM_LEAD_AGENTS,
          AGENT_FANOUT_CONCURRENCY,
          async (a) => {
            const call = await callHook(origin, `agents/${a}`, cronToken, {});
            return { agent: a, ok: call.ok, error: call.error, ...call.body };
          },
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

        const platformSummary = platformResults.map((r, i) =>
          r.status === "fulfilled"
            ? r.value
            : { agent: PLATFORM_LEAD_AGENTS[i], ok: false, error: String(r.reason) },
        );

        const payload = {
          tenants_processed: tenants?.length ?? 0,
          total_insights_created: totalCreated,
          duration_ms: Date.now() - started,
          triggered_by: authed,
          failed_tenants: summary.filter((r) => !r.ok).length,
          results: summary,
          platform_lead_agents: platformSummary,
        };
        if (isTotalFailure(summary as Array<{ ok: boolean }>)) {
          return jsonError("all_tenant_runs_failed", 500, payload);
        }
        return jsonOk(payload);
      },
    },
  },
});
