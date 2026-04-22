/**
 * ACOS Agent: Customer Segmentation
 *
 * Re-classifies every customer of the tenant into one of:
 *   whale       — top 10% by total_spent_cents AND total_orders >= 3
 *   loyal       — total_orders >= 3 AND last_order_at within 60 days
 *   at_risk     — total_orders >= 2 AND no order in 60-120 days
 *   dormant     — last_order_at older than 120 days
 *   newcomer    — total_orders < 2
 *
 * Writes the segment into customers.metadata.segment for downstream targeting,
 * and produces 1 summary insight describing the cohort sizes + revenue mix.
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

const AGENT_ID = "customer_segmentation";

type CustRow = {
  id: string;
  total_orders: number;
  total_spent_cents: number;
  last_order_at: string | null;
  metadata: Record<string, unknown> | null;
};

export const Route = createFileRoute("/hooks/agents/segmentation")({
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
          const { data, error } = await supabaseAdmin
            .from("customers")
            .select("id, total_orders, total_spent_cents, last_order_at, metadata")
            .eq("tenant_id", tenantId)
            .limit(10_000);
          if (error) throw error;
          const customers = (data ?? []) as CustRow[];
          if (customers.length === 0) {
            await finishAgentRun(handle, 0, { customers: 0 });
            return jsonOk({ run_id: handle.runId, customers: 0, insights_created: 0 });
          }

          // p90 spend for whale threshold
          const sorted = [...customers].map((c) => c.total_spent_cents).sort((a, b) => a - b);
          const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
          const now = Date.now();

          const segments: Record<string, { count: number; revenue: number }> = {
            whale: { count: 0, revenue: 0 },
            loyal: { count: 0, revenue: 0 },
            at_risk: { count: 0, revenue: 0 },
            dormant: { count: 0, revenue: 0 },
            newcomer: { count: 0, revenue: 0 },
          };

          const updates: Array<{ id: string; segment: string; metadata: Record<string, unknown> }> =
            [];
          for (const c of customers) {
            const lastDays = c.last_order_at
              ? (now - new Date(c.last_order_at).getTime()) / 86_400_000
              : Number.POSITIVE_INFINITY;
            let seg: string;
            if (c.total_orders >= 3 && c.total_spent_cents >= p90 && p90 > 0) seg = "whale";
            else if (c.total_orders >= 3 && lastDays <= 60) seg = "loyal";
            else if (c.total_orders >= 2 && lastDays > 60 && lastDays <= 120) seg = "at_risk";
            else if (lastDays > 120) seg = "dormant";
            else seg = "newcomer";
            segments[seg].count++;
            segments[seg].revenue += c.total_spent_cents;
            const prevSeg = (c.metadata?.segment as string | undefined) ?? null;
            if (prevSeg !== seg) {
              updates.push({
                id: c.id,
                segment: seg,
                metadata: {
                  ...(c.metadata ?? {}),
                  segment: seg,
                  segment_updated_at: new Date().toISOString(),
                },
              });
            }
          }

          // Apply updates in batches
          let updated = 0;
          for (const u of updates) {
            const { error: upErr } = await supabaseAdmin
              .from("customers")
              .update({ metadata: u.metadata as never })
              .eq("id", u.id);
            if (!upErr) updated++;
          }

          // Build summary insight (only if there's meaningful segmentation movement)
          const insights: AgentInsightInput[] = [];
          const totalRev = Object.values(segments).reduce((s, x) => s + x.revenue, 0);
          const whales = segments.whale;
          const atRisk = segments.at_risk;
          if (atRisk.count >= 5) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "segment_at_risk_cohort",
              affected_layer: "crm",
              title: `${atRisk.count} customers entering "at_risk" cohort`,
              description: `Segmentation refresh found ${atRisk.count} customers (${((atRisk.revenue / Math.max(totalRev, 1)) * 100).toFixed(0)}% of historical revenue) that haven't ordered in 60-120 days. Schedule a winback sequence with a 15% nudge before they go dormant.`,
              expected_impact: `Recover ~${Math.round(atRisk.count * 0.2)} customers (~${((atRisk.revenue * 0.2) / 100 / Math.max(atRisk.count, 1)).toFixed(0)} ₴/each)`,
              confidence: 0.75,
              risk_level: "medium",
              metrics: {
                segment: "at_risk",
                count: atRisk.count,
                revenue_cents: atRisk.revenue,
                segments,
                whales_count: whales.count,
                p90_spent_cents: p90,
                suggested_action: "schedule_winback_cohort",
              },
              dedup_key: `seg_at_risk:weekly`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            customers: customers.length,
            updated,
            segments,
            p90_spent_cents: p90,
          });
          return jsonOk({
            run_id: handle.runId,
            customers: customers.length,
            updated,
            segments,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Agent failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
