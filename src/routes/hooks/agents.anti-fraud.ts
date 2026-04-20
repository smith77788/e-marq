/**
 * Anti-Fraud — heuristic risk scoring для нових paid orders за останні 24 год.
 *
 * Сигнали (кожен += score):
 *  - перший order від email + total ≥ $200             (+0.30)
 *  - 3+ paid orders від цього customer_email за 1 год  (+0.35)
 *  - email домен у "тимчасовому" списку (mailinator, guerrillamail)  (+0.40)
 *  - відсутність ім'я і телефону у metadata           (+0.15)
 *  - сума ≥ 5× від medianу tenant                      (+0.30)
 *
 * Записує в order_fraud_signals (flagged якщо score ≥ 0.6) і створює
 * insight для high-risk orders.
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
  type AgentInsightInput,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "anti-fraud";
const TEMP_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "10minutemail.com",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
]);

export const Route = createFileRoute("/hooks/agents/anti-fraud")({
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
          const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
          const baselineSince = new Date(Date.now() - 60 * 86_400_000).toISOString();

          const [recentRes, baselineRes, existingRes] = await Promise.all([
            supabaseAdmin
              .from("orders")
              .select("id, customer_email, customer_name, total_cents, metadata, created_at, status")
              .eq("tenant_id", tenantId)
              .gte("created_at", since)
              .eq("status", "paid"),
            supabaseAdmin
              .from("orders")
              .select("total_cents")
              .eq("tenant_id", tenantId)
              .gte("created_at", baselineSince)
              .eq("status", "paid")
              .limit(2000),
            supabaseAdmin
              .from("order_fraud_signals")
              .select("order_id")
              .eq("tenant_id", tenantId)
              .gte("created_at", since),
          ]);

          const recent = recentRes.data ?? [];
          const baseline = (baselineRes.data ?? []).map((o) => o.total_cents).sort((a, b) => a - b);
          const median = baseline.length > 0 ? baseline[Math.floor(baseline.length / 2)] : 0;
          const alreadyScored = new Set((existingRes.data ?? []).map((s) => s.order_id));

          // Group by email → counts last hour
          const emailHourCounts = new Map<string, number>();
          const oneHourAgo = Date.now() - 3600_000;
          for (const o of recent) {
            if (!o.customer_email) continue;
            const t = new Date(o.created_at).getTime();
            if (t < oneHourAgo) continue;
            const k = o.customer_email.toLowerCase();
            emailHourCounts.set(k, (emailHourCounts.get(k) ?? 0) + 1);
          }

          const fraudRows: Array<{
            tenant_id: string;
            order_id: string;
            risk_score: number;
            flagged: boolean;
            signals: Array<{ kind: string; weight: number; detail?: string }>;
          }> = [];
          const insights: AgentInsightInput[] = [];

          for (const o of recent) {
            if (alreadyScored.has(o.id)) continue;
            const signals: Array<{ kind: string; weight: number; detail?: string }> = [];
            let score = 0;

            const email = (o.customer_email ?? "").toLowerCase();
            const domain = email.split("@")[1] ?? "";

            // Signal 1: temp email domain
            if (domain && TEMP_DOMAINS.has(domain)) {
              const w = 0.4;
              signals.push({ kind: "temp_email_domain", weight: w, detail: domain });
              score += w;
            }

            // Signal 2: high-value first order from email
            if (o.total_cents >= 20_000) {
              const { count } = await supabaseAdmin
                .from("orders")
                .select("*", { count: "exact", head: true })
                .eq("tenant_id", tenantId)
                .eq("customer_email", o.customer_email ?? "")
                .lt("created_at", o.created_at);
              if ((count ?? 0) === 0) {
                const w = 0.3;
                signals.push({ kind: "first_order_high_value", weight: w });
                score += w;
              }
            }

            // Signal 3: burst — 3+ orders in 1h from same email
            const burst = emailHourCounts.get(email) ?? 0;
            if (burst >= 3) {
              const w = 0.35;
              signals.push({ kind: "email_burst_1h", weight: w, detail: `${burst} orders` });
              score += w;
            }

            // Signal 4: missing name + phone
            const meta = (o.metadata ?? {}) as Record<string, unknown>;
            const hasPhone = typeof meta.phone === "string" && meta.phone.length > 0;
            if (!o.customer_name && !hasPhone) {
              const w = 0.15;
              signals.push({ kind: "missing_identity_fields", weight: w });
              score += w;
            }

            // Signal 5: 5× median amount
            if (median > 0 && o.total_cents >= median * 5) {
              const w = 0.3;
              signals.push({
                kind: "amount_5x_median",
                weight: w,
                detail: `total=${o.total_cents}, median=${median}`,
              });
              score += w;
            }

            if (score === 0) continue;
            const flagged = score >= 0.6;
            fraudRows.push({
              tenant_id: tenantId,
              order_id: o.id,
              risk_score: Math.min(1, score),
              flagged,
              signals,
            });

            if (flagged) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "fraud_risk_high",
                affected_layer: "ops",
                title: `⚠️ Order ${o.id.slice(0, 8)}: підозра на fraud (score ${score.toFixed(2)})`,
                description: `${signals.length} red flags: ${signals.map((s) => s.kind).join(", ")}.`,
                expected_impact: "Перегляньте замовлення вручну до виконання — можливий chargeback.",
                confidence: Math.min(1, 0.5 + score / 2),
                risk_level: "high",
                metrics: {
                  order_id: o.id,
                  total_cents: o.total_cents,
                  customer_email: o.customer_email,
                  signals,
                  risk_score: score,
                  suggested_action: "manual_review",
                },
                dedup_key: `fraud::${o.id}`,
              });
            }
          }

          if (fraudRows.length > 0) {
            for (let i = 0; i < fraudRows.length; i += 100) {
              const chunk = fraudRows.slice(i, i + 100).map((r) => ({
                tenant_id: r.tenant_id,
                order_id: r.order_id,
                risk_score: r.risk_score,
                flagged: r.flagged,
                signals: r.signals as never,
              }));
              const { error } = await supabaseAdmin.from("order_fraud_signals").insert(chunk);
              if (error) throw error;
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            scanned: recent.length,
            scored: fraudRows.length,
            flagged: insights.length,
            median_cents: median,
          });
          return jsonOk({
            run_id: handle.runId,
            scanned: recent.length,
            flagged: insights.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Anti-fraud failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
