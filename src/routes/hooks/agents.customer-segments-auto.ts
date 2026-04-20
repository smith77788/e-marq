/**
 * Customer Segments Auto (ported from MFD `acos-segments-auto`).
 *
 * Авто-генерує customer_segments на основі поведінки:
 * VIP (5+ orders OR $500+ spent), At-Risk (60-120d no order), Dormant (>120d),
 * New (1 order, <30d), High-AOV (avg_order > 2× tenant avg).
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

type SegDef = {
  key: string;
  name: string;
  description: string;
  rules: Record<string, unknown>;
  match: (c: CustomerStat, avgAov: number) => boolean;
};

type CustomerStat = {
  id: string;
  total_orders: number;
  total_spent_cents: number;
  avg_order_cents: number;
  last_order_at: string | null;
  first_order_at: string | null;
  daysSinceLast: number;
};

export const Route = createFileRoute("/hooks/agents/customer-segments-auto")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
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

        const handle = await startAgentRun("customer-segments-auto", tenantId, ctx);
        try {
          const { data: customers } = await supabaseAdmin
            .from("customers")
            .select("id, total_orders, total_spent_cents, avg_order_cents, last_order_at, first_order_at")
            .eq("tenant_id", tenantId);

          if (!customers?.length) {
            await finishAgentRun(handle, 0, { reason: "no_customers" });
            return jsonOk({ insights_created: 0 });
          }

          const now = Date.now();
          const stats: CustomerStat[] = customers.map((c) => ({
            id: c.id,
            total_orders: c.total_orders ?? 0,
            total_spent_cents: c.total_spent_cents ?? 0,
            avg_order_cents: c.avg_order_cents ?? 0,
            last_order_at: c.last_order_at,
            first_order_at: c.first_order_at,
            daysSinceLast: c.last_order_at
              ? Math.floor((now - new Date(c.last_order_at).getTime()) / 86400000)
              : 9999,
          }));

          const tenantAov =
            stats.filter((s) => s.avg_order_cents > 0).reduce((s, c) => s + c.avg_order_cents, 0) /
            Math.max(1, stats.filter((s) => s.avg_order_cents > 0).length);

          const segments: SegDef[] = [
            {
              key: "vip",
              name: "VIP",
              description: "5+ orders OR $500+ lifetime",
              rules: { min_orders: 5, min_spent_cents: 50000, op: "OR" },
              match: (c) => c.total_orders >= 5 || c.total_spent_cents >= 50000,
            },
            {
              key: "at_risk",
              name: "At-Risk",
              description: "Active customer who hasn't ordered in 60-120 days",
              rules: { min_orders: 2, days_since_last_min: 60, days_since_last_max: 120 },
              match: (c) => c.total_orders >= 2 && c.daysSinceLast >= 60 && c.daysSinceLast <= 120,
            },
            {
              key: "dormant",
              name: "Dormant",
              description: "No order for 120+ days",
              rules: { min_orders: 1, days_since_last_min: 120 },
              match: (c) => c.total_orders >= 1 && c.daysSinceLast > 120,
            },
            {
              key: "new",
              name: "New (first 30d)",
              description: "Just 1 order, made within last 30 days",
              rules: { exact_orders: 1, days_since_last_max: 30 },
              match: (c) => c.total_orders === 1 && c.daysSinceLast <= 30,
            },
            {
              key: "high_aov",
              name: "High-AOV",
              description: "Average order ≥ 2× tenant average",
              rules: { avg_aov_multiplier: 2 },
              match: (c) => tenantAov > 0 && c.avg_order_cents >= tenantAov * 2,
            },
          ];

          let upserts = 0;
          for (const s of segments) {
            const matches = stats.filter((c) => s.match(c, tenantAov));
            const avgLtv =
              matches.length > 0
                ? Math.round(
                    matches.reduce((sum, c) => sum + c.total_spent_cents, 0) / matches.length,
                  )
                : 0;
            const { error } = await supabaseAdmin.from("customer_segments").upsert(
              [
                {
                  tenant_id: tenantId!,
                  segment_key: s.key,
                  name: s.name,
                  description: s.description,
                  rules: s.rules as never,
                  customer_count: matches.length,
                  avg_ltv_cents: avgLtv,
                  is_auto_generated: true,
                },
              ],
              { onConflict: "tenant_id,segment_key", ignoreDuplicates: false },
            );
            if (!error) upserts++;
          }

          // Insight: at-risk segment growing
          const atRisk = stats.filter((c) => segments[1].match(c, tenantAov));
          const insights: Parameters<typeof insertInsightsDedup>[0] = [];
          if (atRisk.length >= 5) {
            insights.push({
              tenant_id: tenantId!,
              insight_type: "segment_at_risk_cohort",
              affected_layer: "lifecycle",
              title: `Сегмент At-Risk: ${atRisk.length} клієнтів`,
              description: `Клієнти з 2+ замовленнями зайшли у вікно 60-120 днів неактивності.`,
              expected_impact: `Winback цього сегменту повертає 15-25% — це ~${Math.round(atRisk.length * 0.2)} клієнтів.`,
              confidence: 0.8,
              risk_level: "low",
              metrics: { count: atRisk.length, segment_key: "at_risk" },
              dedup_key: `segment-at-risk::${new Date().toISOString().slice(0, 10)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            segments_upserted: upserts,
            tenant_avg_aov_cents: Math.round(tenantAov),
          });
          return jsonOk({ insights_created: created, segments_upserted: upserts });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Customer segments auto failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
