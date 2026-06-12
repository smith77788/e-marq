/**
 * Cohort Engine — будує retention/revenue curves по місячних когортах.
 *
 * Для кожного місяця (last 6) рахує:
 *   - кількість нових клієнтів (first_order_at у цьому місяці)
 *   - retention[m] = % клієнтів які зробили order в місяці m після першого
 *   - revenue[m]   = total cents у місяці m
 *
 * Записує в `customer_cohorts` (один рядок на cohort_month) і генерує
 * insight, якщо M2 retention < 15% (поганий повторний продаж).
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

const AGENT_ID = "cohort-engine";
const MONTHS = 6;

type OrderRow = {
  customer_email: string | null;
  customer_user_id: string | null;
  total_cents: number;
  paid_at: string | null;
  created_at: string;
};

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export const Route = createFileRoute("/hooks/agents/cohort-engine")({
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
          const since = new Date();
          since.setUTCMonth(since.getUTCMonth() - MONTHS);
          since.setUTCDate(1);
          since.setUTCHours(0, 0, 0, 0);

          const { data, error } = await supabaseAdmin
            .from("orders")
            .select("customer_email, customer_user_id, total_cents, paid_at, created_at")
            .eq("tenant_id", tenantId)
            .in("status", ["paid", "fulfilled"])
            .gte("created_at", since.toISOString())
            .limit(50_000);
          if (error) throw error;
          const orders = (data ?? []) as OrderRow[];
          if (orders.length === 0) {
            await finishAgentRun(handle, 0, { orders: 0 });
            return jsonOk({ run_id: handle.runId, orders: 0, insights_created: 0 });
          }

          // Group orders by customer key
          type CustOrder = { date: Date; cents: number };
          const byCust = new Map<string, CustOrder[]>();
          for (const o of orders) {
            const key = o.customer_user_id ?? (o.customer_email ?? "").toLowerCase();
            if (!key) continue;
            const date = new Date(o.paid_at ?? o.created_at);
            const arr = byCust.get(key) ?? [];
            arr.push({ date, cents: o.total_cents });
            byCust.set(key, arr);
          }

          // Build cohorts: cohort_month -> { customers: Set, retention: number[], revenue: number[] }
          const cohorts = new Map<
            string,
            { firstDates: Map<string, Date>; retention: number[]; revenue: number[] }
          >();

          for (const [cust, list] of byCust) {
            list.sort((a, b) => a.date.getTime() - b.date.getTime());
            const first = list[0].date;
            const cKey = monthKey(first);
            if (!cohorts.has(cKey)) {
              cohorts.set(cKey, {
                firstDates: new Map(),
                retention: Array(MONTHS).fill(0),
                revenue: Array(MONTHS).fill(0),
              });
            }
            const c = cohorts.get(cKey)!;
            c.firstDates.set(cust, first);
            const seenMonths = new Set<number>();
            for (const o of list) {
              const m = monthsBetween(first, o.date);
              if (m < 0 || m >= MONTHS) continue;
              if (!seenMonths.has(m)) {
                c.retention[m]++;
                seenMonths.add(m);
              }
              c.revenue[m] += o.cents;
            }
          }

          // Upsert into customer_cohorts
          let upserted = 0;
          for (const [cKey, c] of cohorts) {
            const total = c.firstDates.size;
            const retentionPct = c.retention.map((cnt) => (total > 0 ? cnt / total : 0));
            // delete + insert (no unique constraint guarantee here)
            const { error: delErr } = await supabaseAdmin
              .from("customer_cohorts")
              .delete()
              .eq("tenant_id", tenantId)
              .eq("cohort_month", cKey);
            if (delErr) console.error("[cohort-engine] delete failed:", delErr.message);
            const { error: insErr } = await supabaseAdmin.from("customer_cohorts").insert({
              tenant_id: tenantId,
              cohort_month: cKey,
              customer_count: total,
              retention_curve: retentionPct as unknown as never,
              revenue_curve: c.revenue as unknown as never,
            });
            if (!insErr) upserted++;
          }

          // Insight: poor M2 retention on the most recent cohort with M2 data
          const insights: AgentInsightInput[] = [];
          const sortedCohorts = Array.from(cohorts.entries()).sort((a, b) =>
            a[0] < b[0] ? 1 : -1,
          );
          for (const [cKey, c] of sortedCohorts) {
            const total = c.firstDates.size;
            if (total < 10) continue;
            const m1Pct = c.retention[1] / total;
            if (m1Pct >= 0.15) continue; // healthy
            insights.push({
              tenant_id: tenantId,
              insight_type: "cohort_low_retention",
              affected_layer: "crm",
              title: `Когорта ${cKey}: повторні покупки <${(m1Pct * 100).toFixed(0)}%`,
              description: `З ${total} клієнтів цієї когорти лише ${c.retention[1]} повернулись наступного місяця. Слабкий second-order — нурт-ланцюжок не працює.`,
              expected_impact: `Підняття M2 retention з ${(m1Pct * 100).toFixed(0)}% до 20% дасть ~${Math.round((0.2 - m1Pct) * total)} додаткових повторних замовлень/місяць.`,
              confidence: 0.7,
              risk_level: "medium",
              metrics: {
                cohort_month: cKey,
                customer_count: total,
                m1_retention_pct: m1Pct,
                retention_curve: c.retention.map((x) => x / Math.max(total, 1)),
                revenue_curve: c.revenue,
                suggested_action: "second_order_nurture",
              },
              dedup_key: `cohort_low::${cKey}`,
            });
            break;
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            cohorts: cohorts.size,
            upserted,
            orders: orders.length,
          });
          return jsonOk({
            run_id: handle.runId,
            cohorts: cohorts.size,
            upserted,
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
