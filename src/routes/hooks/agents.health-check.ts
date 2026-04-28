/**
 * HealthCheckAgent — агрегує acos_agent_runs за останні 24 години
 * у таблицю agent_health (один рядок на tenant + agent + date).
 *
 * Це "нерв спостережуваності" мережі: інші агенти працюють, а цей дає
 * оператору видиму картину їхнього здоров'я.
 *
 * Запускається hourly через pg_cron. Cron-only auth.
 *
 * Body: {} (агрегує по всіх активних tenants)
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isCronToken } from "@/lib/acos/cronAuth";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";

const AGENT_ID = "health-check";
const WINDOW_HOURS = 24;

type AggKey = string; // `${tenantId}::${agentId}::${dateISO}`

type AggValue = {
  tenant_id: string;
  agent_id: string;
  measured_on: string;
  runs_total: number;
  runs_failed: number;
  insights_created: number;
};

export const Route = createFileRoute("/hooks/agents/health-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!isCronToken(token)) return jsonError("Unauthorized", 401);

        const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
        const today = new Date().toISOString().slice(0, 10);

        // 1. Pull last 24h of agent runs
        const { data: runs, error: runsErr } = await supabaseAdmin
          .from("acos_agent_runs")
          .select("tenant_id, agent_id, status, insights_created, started_at")
          .gte("started_at", since);
        if (runsErr) return jsonError(runsErr.message, 500);

        // 2. Aggregate
        const agg = new Map<AggKey, AggValue>();
        for (const r of runs ?? []) {
          if (!r.tenant_id || !r.agent_id) continue;
          const key: AggKey = `${r.tenant_id}::${r.agent_id}::${today}`;
          const existing = agg.get(key) ?? {
            tenant_id: r.tenant_id,
            agent_id: r.agent_id,
            measured_on: today,
            runs_total: 0,
            runs_failed: 0,
            insights_created: 0,
          };
          existing.runs_total += 1;
          if (r.status === "failed") existing.runs_failed += 1;
          existing.insights_created += r.insights_created ?? 0;
          agg.set(key, existing);
        }

        // 3. Pull insight approvals for the same window to compute approval ratio
        const { data: actions } = await supabaseAdmin
          .from("ai_actions")
          .select("tenant_id, agent_id, status, applied_at")
          .gte("created_at", since);

        const approvedByKey = new Map<string, number>();
        const dismissedByKey = new Map<string, number>();
        for (const a of actions ?? []) {
          if (!a.tenant_id || !a.agent_id) continue;
          const key = `${a.tenant_id}::${a.agent_id}::${today}`;
          if (a.status === "applied") {
            approvedByKey.set(key, (approvedByKey.get(key) ?? 0) + 1);
          } else if (a.status === "dismissed" || a.status === "rejected") {
            dismissedByKey.set(key, (dismissedByKey.get(key) ?? 0) + 1);
          }
        }

        // 4. Compute health_score and prepare upserts
        const rows = Array.from(agg.values()).map((v) => {
          const key = `${v.tenant_id}::${v.agent_id}::${today}`;
          const approved = approvedByKey.get(key) ?? 0;
          const dismissed = dismissedByKey.get(key) ?? 0;
          const failureRate = v.runs_total > 0 ? v.runs_failed / v.runs_total : 0;
          const productivity = Math.min(1, v.insights_created / Math.max(1, v.runs_total));
          const acceptance =
            approved + dismissed > 0 ? approved / (approved + dismissed) : 0.5;
          // health = (1 - failureRate) * 0.5 + productivity * 0.25 + acceptance * 0.25
          const score = (1 - failureRate) * 0.5 + productivity * 0.25 + acceptance * 0.25;
          return {
            tenant_id: v.tenant_id,
            agent_id: v.agent_id,
            measured_on: v.measured_on,
            runs_total: v.runs_total,
            runs_failed: v.runs_failed,
            insights_created: v.insights_created,
            insights_approved: approved,
            insights_dismissed: dismissed,
            measured_revenue_lift_cents: 0,
            health_score: Number(score.toFixed(3)),
          };
        });

        if (rows.length === 0) {
          return jsonOk({ aggregated: 0, hint: "no agent runs in window" });
        }

        // 5. Upsert (delete same-day rows then insert — simple & idempotent)
        const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id)));
        for (const tid of tenantIds) {
          await supabaseAdmin
            .from("agent_health")
            .delete()
            .eq("tenant_id", tid)
            .eq("measured_on", today);
        }
        for (let i = 0; i < rows.length; i += 100) {
          const chunk = rows.slice(i, i + 100);
          const { error } = await supabaseAdmin.from("agent_health").insert(chunk);
          if (error) return jsonError(error.message, 500);
        }

        return jsonOk({
          agent: AGENT_ID,
          aggregated: rows.length,
          tenants: tenantIds.length,
          measured_on: today,
        });
      },
      GET: async () =>
        new Response(
          JSON.stringify({ ok: true, hint: "POST with cron bearer token" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  },
});
