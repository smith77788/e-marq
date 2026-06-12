/**
 * Cron-chunk: запускає підмножину агентів для всіх активних tenants.
 *
 * Замість одного важкого `cron-all` (75+ агентів послідовно — таймаут на проді),
 * розбиваємо на чанки які можна планувати окремо: catalog, marketing, ops, lead-gen.
 *
 * Body: { chunk: "catalog" | "marketing" | "ops" | "lead-gen" | "platform" }
 * Auth: SUPABASE_PUBLISHABLE_KEY (cron) — той самий що в існуючих pg_cron headers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FANOUT_TENANT_STATUSES } from "@/lib/acos/fanoutTenants";
import {
  AGENT_FANOUT_CONCURRENCY,
  TENANT_FANOUT_CONCURRENCY,
  allSettledWithConcurrency,
  callHook,
  isTotalFailure,
} from "@/lib/acos/fanout";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { isCronToken } from "@/lib/acos/cronAuth";

const CHUNKS: Record<string, readonly string[]> = {
  catalog: [
    "brand-profile",
    "catalog-enricher",
    "margin-estimator",
    "channel-discovery",
    "seasonality-detector",
    "integration-scout",
    "data-gap-auditor",
    "customer-voice",
  ],
  marketing: [
    "aov-optimizer",
    "price-optimizer",
    "predictive-pricing",
    "bundle-recommender",
    "promo-fatigue",
    "promo-portfolio",
    "discount-elasticity",
    "broadcast-composer",
    "best-time-to-send",
    "nurture-roi",
    "broadcast-roi",
    "winback-roi",
  ],
  ops: [
    "stockout",
    "inventory-forecast",
    "inventory-rebalance",
    "restock-alert",
    "anti-fraud",
    "action-watchdog",
    "conflict-resolver",
    "shipping-optimizer",
    "return-predictor",
    "payment-retry",
    "refund-risk",
    "anomaly-detector",
  ],
  retention: [
    "churn-risk",
    "ltv-predictor",
    "cart-recovery",
    "browse-abandonment",
    "second-order-nurture",
    "first-order-funnel",
    "loyalty-tiers",
    "vip-concierge",
    "customer-segments-auto",
    "customer-churn-predictor",
    "cohort-engine",
    "lifecycle-trigger-tuner",
    "email-abandoned-cart",
    "email-winback",
    "email-post-purchase",
    "restock-notifier",
  ],
  // Lead-gen працюють multi-tenant самі; запускаємо ОДИН раз без tenant_id
  "lead-gen": [
    "web-prospector",
    "outreach-google-hunter",
    "outreach-reddit-hunter",
    "outreach-quality-scorer",
    "outreach-composer",
    "outreach-roi-collector",
  ],
};

const PER_TENANT_CHUNKS = new Set(["catalog", "marketing", "ops", "retention"]);

export const Route = createFileRoute("/hooks/agents/cron-chunk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token || !isCronToken(token)) {
          return jsonError("Unauthorized", 401);
        }

        const body = (await request.json().catch(() => ({}))) as { chunk?: string };
        const chunk = String(body.chunk ?? "");
        const agents = CHUNKS[chunk];
        if (!agents) return jsonError(`unknown chunk '${chunk}'`, 400);

        const origin = new URL(request.url).origin;
        const started = Date.now();

        // Lead-gen — multi-tenant single-shot
        if (!PER_TENANT_CHUNKS.has(chunk)) {
          const out = await allSettledWithConcurrency(
            agents,
            AGENT_FANOUT_CONCURRENCY,
            async (a) => {
              const call = await callHook(origin, `agents/${a}`, token, {});
              return { agent: a, ok: call.ok, error: call.error, ...call.body };
            },
          );
          const summary = out.map((r, i) =>
            r.status === "fulfilled"
              ? r.value
              : { agent: agents[i], ok: false, error: String(r.reason) },
          );
          const payload = {
            chunk,
            duration_ms: Date.now() - started,
            failed_agents: summary.filter((r) => !r.ok).length,
            agents: summary,
          };
          if (isTotalFailure(summary as Array<{ ok: boolean }>)) {
            return jsonError("all_agent_runs_failed", 500, payload);
          }
          return jsonOk(payload);
        }

        // Per-tenant: для кожного активного tenant викликаємо агентів чанка.
        // Конкуренція обмежена (tenant'и × агенти), кожен виклик з таймаутом —
        // раніше тут стартувало до ~800 одночасних fetch'ів без таймауту.
        const { data: tenants } = await supabaseAdmin
          .from("tenants")
          .select("id, slug")
          .in("status", [...FANOUT_TENANT_STATUSES])
          .limit(50);

        const tenantResults = await allSettledWithConcurrency(
          tenants ?? [],
          TENANT_FANOUT_CONCURRENCY,
          async (t) => {
            const inner = await allSettledWithConcurrency(
              agents,
              AGENT_FANOUT_CONCURRENCY,
              async (a) => {
                const call = await callHook(origin, `agents/${a}`, token, { tenant_id: t.id });
                return {
                  agent: a,
                  ok: call.ok,
                  insights_created:
                    typeof call.body.insights_created === "number" ? call.body.insights_created : 0,
                };
              },
            );
            const created = inner.reduce((s, r) => {
              if (r.status !== "fulfilled") return s;
              return s + (r.value.insights_created ?? 0);
            }, 0);
            const failed = inner.filter(
              (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
            ).length;
            return {
              tenant: t.slug,
              agents: agents.length,
              insights_created: created,
              failed,
              ok: failed < agents.length,
            };
          },
        );

        const summary = tenantResults.map((r) =>
          r.status === "fulfilled" ? r.value : { ok: false, error: String(r.reason) },
        );
        const payload = {
          chunk,
          tenants_processed: tenants?.length ?? 0,
          duration_ms: Date.now() - started,
          failed_tenants: summary.filter((r) => !r.ok).length,
          per_tenant: summary,
        };
        if (isTotalFailure(summary as Array<{ ok: boolean }>)) {
          return jsonError("all_tenant_runs_failed", 500, payload);
        }
        return jsonOk(payload);
      },
    },
  },
});
