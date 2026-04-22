/**
 * ACOS Agent: Bot Quality Audit
 *
 * Scans last 7d of conversations (channel='telegram', direction='outbound'
 * with metadata.source='sales_bot'). Computes:
 *   - reply_count: outbound msgs sent by sales bot
 *   - reply_rate: outbound msgs that received an inbound reply within 24h
 *   - conversion_rate: outbound msgs whose customer placed a paid order within 7d
 *
 * If reply_rate < 15% AND reply_count >= 20 → low_engagement insight
 * If conversion_rate >= 8% AND reply_count >= 20 → high_performing insight (memory boost)
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

const AGENT_ID = "bot_quality_audit";
const WINDOW_DAYS = 7;

type ConvRow = {
  id: string;
  customer_id: string | null;
  direction: string;
  created_at: string;
  metadata: { source?: string } | null;
};

export const Route = createFileRoute("/hooks/agents/bot-quality")({
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
          const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
          const { data: convs, error } = await supabaseAdmin
            .from("conversations")
            .select("id, customer_id, direction, created_at, metadata")
            .eq("tenant_id", tenantId)
            .gte("created_at", since)
            .order("created_at", { ascending: true })
            .limit(10_000);
          if (error) throw error;

          const rows = (convs ?? []) as ConvRow[];
          // Outbound messages from sales bot
          const outbound = rows.filter(
            (r) =>
              r.direction === "outbound" && r.metadata?.source === "sales_bot" && r.customer_id,
          );
          // Inbound by customer
          const inboundByCustomer = new Map<string, number[]>();
          for (const r of rows) {
            if (r.direction === "inbound" && r.customer_id) {
              const arr = inboundByCustomer.get(r.customer_id) ?? [];
              arr.push(new Date(r.created_at).getTime());
              inboundByCustomer.set(r.customer_id, arr);
            }
          }

          let replied = 0;
          const customersContacted = new Set<string>();
          for (const o of outbound) {
            if (!o.customer_id) continue;
            customersContacted.add(o.customer_id);
            const sentAt = new Date(o.created_at).getTime();
            const replies = inboundByCustomer.get(o.customer_id) ?? [];
            if (replies.some((t) => t > sentAt && t <= sentAt + 24 * 3600_000)) replied++;
          }

          // Conversions: paid orders within 7d after first contact
          let conversions = 0;
          if (customersContacted.size > 0) {
            const { data: orders } = await supabaseAdmin
              .from("orders")
              .select("customer_email, paid_at, total_cents")
              .eq("tenant_id", tenantId)
              .eq("status", "paid")
              .gte("paid_at", since);
            // Map customer_id → email via customers table
            const { data: customers } = await supabaseAdmin
              .from("customers")
              .select("id, email")
              .eq("tenant_id", tenantId)
              .in("id", Array.from(customersContacted));
            const idToEmail = new Map<string, string>();
            for (const c of customers ?? []) {
              if (c.email) idToEmail.set(c.id, c.email.toLowerCase());
            }
            const paidEmails = new Set<string>();
            for (const o of orders ?? []) {
              if (o.customer_email) paidEmails.add(o.customer_email.toLowerCase());
            }
            for (const cid of customersContacted) {
              const e = idToEmail.get(cid);
              if (e && paidEmails.has(e)) conversions++;
            }
          }

          const replyRate = outbound.length > 0 ? replied / outbound.length : 0;
          const conversionRate =
            customersContacted.size > 0 ? conversions / customersContacted.size : 0;

          const insights: AgentInsightInput[] = [];
          if (outbound.length >= 20 && replyRate < 0.15) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bot_low_engagement",
              affected_layer: "bot",
              title: `Sales bot reply rate is ${(replyRate * 100).toFixed(1)}% — below 15% target`,
              description: `Last ${WINDOW_DAYS} days: ${outbound.length} bot messages sent, only ${replied} got a reply within 24h. Tone may be too pushy, or template too generic. Consider testing a softer opener and adding a question that invites response.`,
              expected_impact: `Lift to 25% reply rate could mean ~${Math.round(outbound.length * 0.1)} extra conversations/week`,
              confidence: 0.7,
              risk_level: "medium",
              metrics: {
                window_days: WINDOW_DAYS,
                outbound_count: outbound.length,
                replied_count: replied,
                reply_rate: Number(replyRate.toFixed(3)),
                conversion_rate: Number(conversionRate.toFixed(3)),
                suggested_action: "tune_bot_template",
              },
              dedup_key: `bot_low_eng:${WINDOW_DAYS}d`,
            });
          }
          if (outbound.length >= 20 && conversionRate >= 0.08) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bot_high_performance",
              affected_layer: "bot",
              title: `Sales bot converting at ${(conversionRate * 100).toFixed(1)}% — boost cadence`,
              description: `Last ${WINDOW_DAYS} days: ${customersContacted.size} customers contacted, ${conversions} placed a paid order within the window. The current playbook is working — consider lowering recency threshold to contact warm leads sooner.`,
              expected_impact: `Doubling cadence could reach ~${Math.round(customersContacted.size * 0.5)} more customers/week`,
              confidence: 0.8,
              risk_level: "low",
              metrics: {
                window_days: WINDOW_DAYS,
                outbound_count: outbound.length,
                replied_count: replied,
                conversions,
                conversion_rate: Number(conversionRate.toFixed(3)),
                suggested_action: "boost_bot_cadence",
              },
              dedup_key: `bot_high_perf:${WINDOW_DAYS}d`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            outbound_count: outbound.length,
            replied_count: replied,
            reply_rate: Number(replyRate.toFixed(3)),
            conversion_rate: Number(conversionRate.toFixed(3)),
          });
          return jsonOk({
            run_id: handle.runId,
            outbound_count: outbound.length,
            reply_rate: Number(replyRate.toFixed(3)),
            conversion_rate: Number(conversionRate.toFixed(3)),
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
