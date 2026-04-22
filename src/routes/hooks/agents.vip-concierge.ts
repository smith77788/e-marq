/**
 * VIP Concierge — пропонує персональні дії для топ-VIP клієнтів,
 * що тривалий час не робили замовлень.
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
  type AgentInsightInput,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "vip-concierge";

export const Route = createFileRoute("/hooks/agents/vip-concierge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
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
          const { data: vips } = await supabaseAdmin
            .from("customers")
            .select(
              "id, name, email, total_spent_cents, total_orders, last_order_at, avg_cycle_days",
            )
            .eq("tenant_id", tenantId)
            .eq("lifecycle_stage", "vip")
            .order("total_spent_cents", { ascending: false })
            .limit(20);

          const insights: AgentInsightInput[] = [];
          const now = Date.now();
          for (const v of vips ?? []) {
            if (!v.last_order_at) continue;
            const daysSince = (now - new Date(v.last_order_at).getTime()) / 86_400_000;
            const expected = v.avg_cycle_days ?? 30;
            // Flag when VIP went silent for 1.5x their normal cycle
            if (daysSince < expected * 1.5) continue;

            insights.push({
              tenant_id: tenantId,
              insight_type: "vip_silent",
              affected_layer: "customer",
              title: `💎 VIP мовчить: ${v.name ?? v.email ?? "клієнт"} (${daysSince.toFixed(0)} дн.)`,
              description: `LTV ${(v.total_spent_cents / 100).toFixed(0)} ₴, ${v.total_orders} замовлень. Звичайний цикл ${expected.toFixed(0)} дн.`,
              expected_impact: `Персональне повідомлення з ексклюзивом може повернути ~${(v.total_spent_cents / v.total_orders / 100).toFixed(0)} ₴`,
              confidence: 0.8,
              risk_level: daysSince > expected * 3 ? "high" : "medium",
              metrics: {
                customer_id: v.id,
                customer_name: v.name,
                customer_email: v.email,
                ltv_cents: v.total_spent_cents,
                days_since_last_order: daysSince,
                avg_cycle_days: expected,
                suggested_action: "send_vip_personal_outreach",
              },
              dedup_key: `vip-silent::${v.id}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { vips_evaluated: vips?.length ?? 0 });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("VIP concierge failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
