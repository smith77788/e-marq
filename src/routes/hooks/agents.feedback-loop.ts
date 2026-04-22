/**
 * Feedback loop — measures outbound message outcomes and updates decision_policies.
 *
 * For every `sent` outbound message older than 7 days that hasn't been measured:
 *   - Look for paid orders by same customer in the [sent_at, sent_at + 7d] window.
 *   - If found: status='converted', actual_revenue_cents=sum.
 *   - Update decision_policies for the matching trigger_kind (win_count, total_revenue, trial_count).
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  startAgentRun,
  finishAgentRun,
  failAgentRun,
  jsonError,
  jsonOk,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "feedback_loop";

type Outbound = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  trigger_kind: string;
  sent_at: string;
  expected_impact_cents: number | null;
};

export const Route = createFileRoute("/hooks/agents/feedback-loop")({
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
          const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
          const { data: rows } = await supabaseAdmin
            .from("outbound_messages")
            .select("id, tenant_id, customer_id, trigger_kind, sent_at, expected_impact_cents")
            .eq("tenant_id", tenantId)
            .in("status", ["sent", "replied"])
            .not("sent_at", "is", null)
            .is("converted_at", null)
            .lte("sent_at", cutoff)
            .limit(200);

          let measured = 0,
            conversions = 0,
            totalRevenue = 0;
          const policyAgg: Record<string, { trials: number; wins: number; revenue: number }> = {};

          for (const r of (rows ?? []) as Outbound[]) {
            policyAgg[r.trigger_kind] = policyAgg[r.trigger_kind] ?? {
              trials: 0,
              wins: 0,
              revenue: 0,
            };
            policyAgg[r.trigger_kind].trials++;

            if (!r.customer_id) {
              await supabaseAdmin
                .from("outbound_messages")
                .update({ actual_revenue_cents: 0 })
                .eq("id", r.id);
              measured++;
              continue;
            }

            // Find customer email/telegram for matching orders
            const { data: customer } = await supabaseAdmin
              .from("customers")
              .select("email")
              .eq("id", r.customer_id)
              .maybeSingle();
            const email = customer?.email ?? null;
            if (!email) {
              await supabaseAdmin
                .from("outbound_messages")
                .update({ actual_revenue_cents: 0 })
                .eq("id", r.id);
              measured++;
              continue;
            }

            const sentAt = r.sent_at;
            const windowEnd = new Date(
              new Date(sentAt).getTime() + 7 * 24 * 3600 * 1000,
            ).toISOString();
            const { data: orders } = await supabaseAdmin
              .from("orders")
              .select("total_cents")
              .eq("tenant_id", tenantId)
              .eq("status", "paid")
              .ilike("customer_email", email)
              .gte("paid_at", sentAt)
              .lte("paid_at", windowEnd);
            const revenue = (orders ?? []).reduce((s, o) => s + (o.total_cents ?? 0), 0);

            await supabaseAdmin
              .from("outbound_messages")
              .update({
                actual_revenue_cents: revenue,
                status: revenue > 0 ? "converted" : undefined,
                converted_at: revenue > 0 ? new Date().toISOString() : null,
              })
              .eq("id", r.id);
            measured++;
            if (revenue > 0) {
              conversions++;
              totalRevenue += revenue;
              policyAgg[r.trigger_kind].wins++;
              policyAgg[r.trigger_kind].revenue += revenue;
            }
          }

          // Push aggregates into decision_policies
          for (const [kind, agg] of Object.entries(policyAgg)) {
            const policyKey = `engine.${kind}.performance`;
            const { data: existing } = await supabaseAdmin
              .from("decision_policies")
              .select("id, trial_count, win_count, total_revenue_cents")
              .eq("tenant_id", tenantId)
              .eq("policy_key", policyKey)
              .eq("is_active", true)
              .maybeSingle();
            if (existing) {
              await supabaseAdmin
                .from("decision_policies")
                .update({
                  trial_count: existing.trial_count + agg.trials,
                  win_count: existing.win_count + agg.wins,
                  total_revenue_cents: existing.total_revenue_cents + agg.revenue,
                  reason: `Updated by feedback loop: ${agg.wins}/${agg.trials} wins this batch`,
                })
                .eq("id", existing.id);
            } else {
              await supabaseAdmin.from("decision_policies").insert({
                tenant_id: tenantId,
                policy_key: policyKey,
                value: { kind } as never,
                trial_count: agg.trials,
                win_count: agg.wins,
                total_revenue_cents: agg.revenue,
                reason: `Initial measurement`,
              });
            }
          }

          await finishAgentRun(handle, measured, {
            conversions,
            total_revenue_cents: totalRevenue,
          });
          return jsonOk({ measured, conversions, total_revenue_cents: totalRevenue });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Feedback loop failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
