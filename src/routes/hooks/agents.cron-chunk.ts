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
          const out = await Promise.allSettled(
            agents.map(async (a) => {
              const res = await fetch(`${origin}/hooks/agents/${a}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({}),
              });
              const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
              return { agent: a, ok: res.ok, ...j };
            }),
          );
          const summary = out.map((r, i) =>
            r.status === "fulfilled"
              ? r.value
              : { agent: agents[i], ok: false, error: String(r.reason) },
          );
          return jsonOk({
            chunk,
            duration_ms: Date.now() - started,
            agents: summary,
          });
        }

        // Per-tenant: для кожного активного tenant викликаємо КОЖНОГО агента
        // ПАРАЛЕЛЬНО (Promise.all обмежено всередині fetch). Не використовуємо
        // важкий run-all — щоб уникнути cascading timeouts.
        const { data: tenants } = await supabaseAdmin
          .from("tenants")
          .select("id, slug")
          .eq("status", "active")
          .limit(50);

        const tenantResults = await Promise.allSettled(
          (tenants ?? []).map(async (t) => {
            const inner = await Promise.allSettled(
              agents.map(async (a) => {
                const res = await fetch(`${origin}/hooks/agents/${a}`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ tenant_id: t.id }),
                });
                const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
                return {
                  agent: a,
                  ok: res.ok,
                  insights_created: typeof j.insights_created === "number" ? j.insights_created : 0,
                };
              }),
            );
            const created = inner.reduce((s, r) => {
              if (r.status !== "fulfilled") return s;
              return s + (r.value.insights_created ?? 0);
            }, 0);
            const failed = inner.filter(
              (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
            ).length;
            return { tenant: t.slug, agents: agents.length, insights_created: created, failed };
          }),
        );

        const summary = tenantResults.map((r) =>
          r.status === "fulfilled" ? r.value : { error: String(r.reason) },
        );
        return jsonOk({
          chunk,
          tenants_processed: tenants?.length ?? 0,
          duration_ms: Date.now() - started,
          per_tenant: summary,
        });
      },
    },
  },
});
