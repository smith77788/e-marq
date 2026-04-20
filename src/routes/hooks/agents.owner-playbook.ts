/**
 * Owner Playbook — генерує "тижневий playbook" для власника:
 * top-3 high-risk insights + top-3 high-confidence opportunities.
 * Створює один meta-insight типу `owner_playbook` зі списком дій
 * у metrics, готових до 1-click apply.
 *
 * Це дозволяє власнику бачити "ось 6 кроків на тиждень" замість
 * 30 розрізнених інсайтів.
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  failAgentRun,
  finishAgentRun,
  insertInsightsDedup,
  jsonError,
  jsonOk,
  startAgentRun,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "owner-playbook";

export const Route = createFileRoute("/hooks/agents/owner-playbook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        let tenantId: string | null = null;
        try {
          const body = (await request.json()) as { tenant_id?: string };
          tenantId = body.tenant_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        if (!tenantId) return jsonError("tenant_id required", 400);

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const handle = await startAgentRun(AGENT_ID, tenantId, ctx);
        try {
          const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("ai_insights")
            .select(
              "id, insight_type, title, expected_impact, confidence, risk_level, status, created_at",
            )
            .eq("tenant_id", tenantId)
            .in("status", ["new", "in_review"])
            .gte("created_at", since)
            .neq("insight_type", "owner_playbook")
            .order("created_at", { ascending: false })
            .limit(200);
          if (error) throw error;
          const open = data ?? [];
          if (open.length < 3) {
            await finishAgentRun(handle, 0, { reason: "insufficient_open_insights", count: open.length });
            return jsonOk({ run_id: handle.runId, insights_created: 0 });
          }

          const highRisk = open
            .filter((i) => i.risk_level === "high")
            .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
            .slice(0, 3);

          const opportunities = open
            .filter((i) => i.risk_level !== "high" && Number(i.confidence ?? 0) >= 0.7)
            .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
            .slice(0, 3);

          if (highRisk.length === 0 && opportunities.length === 0) {
            await finishAgentRun(handle, 0, { reason: "no_actionable_items" });
            return jsonOk({ run_id: handle.runId, insights_created: 0 });
          }

          const playbookItems = [
            ...highRisk.map((i) => ({
              insight_id: i.id,
              type: i.insight_type,
              title: i.title,
              expected_impact: i.expected_impact,
              category: "fix",
              confidence: i.confidence,
            })),
            ...opportunities.map((i) => ({
              insight_id: i.id,
              type: i.insight_type,
              title: i.title,
              expected_impact: i.expected_impact,
              category: "grow",
              confidence: i.confidence,
            })),
          ];

          const created = await insertInsightsDedup([
            {
              tenant_id: tenantId,
              insight_type: "owner_playbook",
              affected_layer: "system",
              title: `Playbook на тиждень: ${highRisk.length} fix + ${opportunities.length} grow`,
              description: `Згенерований план на 7 днів: ${highRisk.length} критичних правок та ${opportunities.length} можливостей зростання.`,
              expected_impact:
                "Виконання playbook'а зазвичай дає +15-30% revenue impact за квартал — концентрація на найвпливовіших кроках.",
              confidence: 0.9,
              risk_level: "low",
              metrics: {
                playbook_items: playbookItems,
                fix_count: highRisk.length,
                grow_count: opportunities.length,
                generated_for_week_starting: new Date().toISOString().slice(0, 10),
                suggested_action: "review_and_apply_in_order",
              },
              dedup_key: `playbook::${new Date().toISOString().slice(0, 10)}`,
            },
          ]);

          await finishAgentRun(handle, created, {
            fix: highRisk.length,
            grow: opportunities.length,
          });
          return jsonOk({
            run_id: handle.runId,
            playbook_size: playbookItems.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Owner playbook failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
