/**
 * ACOS Orchestrator: runs all agents for a tenant in parallel.
 * Body: { tenant_id? }
 *
 * If `tenant_id` is omitted (cron-style invocation) we fan-out across every
 * active tenant. This is what the `marq-agents-run-all-15min` pg_cron job
 * does — it must NOT 400. Cron auth is required for fan-out mode.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { isCronToken } from "@/lib/acos/cronAuth";

const AGENTS = [
  // Original ACOS agents
  "onboarding",
  "churn-risk",
  "stockout",
  "aov-leak",
  "search-gap",
  "aov-optimizer",
  "price-optimizer",
  "price-revert",
  "bot-quality",
  "segmentation",
  "memory-feedback",
  // Batch 1: ported from MFD
  "margin-optimizer",
  "ltv-predictor",
  "cart-recovery",
  "anomaly-detector",
  "morning-brief",
  // Batch 2: promo + bundles
  "bundle-recommender",
  "promo-fatigue",
  "promo-portfolio",
  "discount-elasticity",
  "predictive-pricing",
  // Batch 3: analytics
  "cohort-engine",
  "attribution",
  "funnel-healer",
  "browse-abandonment",
  "second-order-nurture",
  // Batch 4: messaging
  "bot-sequences",
  "broadcast-composer",
  "best-time-to-send",
  "csat-dispatcher",
  "nurture-roi",
  // Batch 5: SEO/content
  "seo-rewriter",
  "content-velocity",
  "ugc-harvester",
  "search-intent-miner",
  "programmatic-seo",
  // Batch 6: customer/loyalty
  "customer-segments-auto",
  "loyalty-tiers",
  "product-affinity",
  "customer-churn-predictor",
  "first-order-funnel",
  // Batch 7: ops/safety
  "inventory-forecast",
  "restock-alert",
  "anti-fraud",
  "action-watchdog",
  "conflict-resolver",
  // Batch 8: ROI/learning
  "social-proof-live",
  "broadcast-roi",
  "winback-roi",
  "elasticity-meta-loop",
  "learning-loop-monitor",
  // Batch 9: orchestration
  "notification-router",
  "daily-digest-v2",
  "owner-playbook",
  "meta-prior-injector",
  "autonomous-seo-loop",
  // Batch 11: bootstrap discoverers (run FIRST so working agents have ground truth)
  "brand-profile",
  "catalog-enricher",
  "margin-estimator",
  "customer-voice",
  "channel-discovery",
  "seasonality-detector",
  "integration-scout",
  "data-gap-auditor",
  // Batch 10: ops, retention, capital efficiency
  "shipping-optimizer",
  "return-predictor",
  "vip-concierge",
  "review-velocity",
  "payment-retry",
  "geo-demand",
  "time-of-day-pricer",
  "refund-risk",
  "lifecycle-trigger-tuner",
  "inventory-rebalance",
  // Sprint 6: email lifecycle + restock
  "email-abandoned-cart",
  "email-winback",
  "email-post-purchase",
  "order-status-notifier",
  "restock-notifier",
] as const;

export const Route = createFileRoute("/hooks/agents/run-all")({
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
        const origin = new URL(request.url).origin;

        // Cron fan-out: no tenant_id → require cron token, then per-tenant call.
        if (!tenantId) {
          if (!isCronToken(token)) return jsonError("Unauthorized", 401);
          const { data: tenants, error: tErr } = await supabaseAdmin
            .from("tenants")
            .select("id, slug")
            .eq("status", "active")
            .limit(50);
          if (tErr) return jsonError("tenant lookup failed", 500, { details: tErr.message });

          const fan = await Promise.allSettled(
            (tenants ?? []).map(async (t) => {
              const r = await fetch(`${origin}/hooks/agents/run-all`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ tenant_id: t.id }),
              });
              const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
              const ic = typeof j.insights_created === "number" ? j.insights_created : 0;
              return { tenant: t.slug, ok: r.ok, insights_created: ic };
            }),
          );
          const summary = fan.map((r) =>
            r.status === "fulfilled"
              ? r.value
              : { tenant: "?", ok: false, error: String(r.reason) },
          );
          const total = summary.reduce(
            (s, r) =>
              s +
              (typeof (r as { insights_created?: number }).insights_created === "number"
                ? (r as { insights_created: number }).insights_created
                : 0),
            0,
          );
          return jsonOk({
            mode: "fan-out",
            tenants_processed: tenants?.length ?? 0,
            insights_created: total,
            per_tenant: summary,
          });
        }

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const results = await Promise.allSettled(
          AGENTS.map(async (a) => {
            const res = await fetch(`${origin}/hooks/agents/${a}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ tenant_id: tenantId }),
            });
            const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            return { agent: a, ok: res.ok, ...json };
          }),
        );

        const summary = results.map((r, i) =>
          r.status === "fulfilled"
            ? r.value
            : { agent: AGENTS[i], ok: false, error: String(r.reason) },
        );
        const totalCreated = summary.reduce((s, r) => {
          const v = (r as Record<string, unknown>).insights_created;
          return s + (typeof v === "number" ? v : 0);
        }, 0);

        return jsonOk({ insights_created: totalCreated, agents: summary });
      },
    },
  },
});
