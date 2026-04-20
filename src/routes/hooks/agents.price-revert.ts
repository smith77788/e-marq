/**
 * Price Revert Safety Agent.
 *
 * Watches `ai_actions` of type `update_price` that were applied 14-30 days ago.
 * For each, compares conversion (purchases / views) for the 14d window BEFORE
 * the change vs the 14d window AFTER. If post/pre conversion ratio < 0.7
 * (i.e. >30% drop), creates a `price_revert` insight suggesting rollback to
 * the previous price.
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
  insertInsightsDedup,
  jsonError,
  jsonOk,
  type AgentInsightInput,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "price_revert_safety";
const WINDOW_DAYS = 14;
const DROP_THRESHOLD = 0.7; // post/pre conversion ratio below this → revert
const MIN_VIEWS_PRE = 20; // need enough signal pre-change to trust the comparison

type PriceActionRow = {
  id: string;
  applied_at: string;
  target_id: string;
  actual_result: { old_price_cents?: number; new_price_cents?: number } | null;
};

async function countEvents(
  tenantId: string,
  productId: string,
  type: "product_viewed" | "purchase_completed",
  fromIso: string,
  toIso: string,
): Promise<number> {
  const { count } = await supabaseAdmin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .eq("type", type)
    .gte("created_at", fromIso)
    .lt("created_at", toIso);
  return count ?? 0;
}

async function analyzePriceAction(
  tenantId: string,
  action: PriceActionRow,
): Promise<AgentInsightInput | null> {
  const oldPrice = action.actual_result?.old_price_cents;
  const newPrice = action.actual_result?.new_price_cents;
  if (oldPrice == null || newPrice == null || oldPrice === newPrice) return null;

  const applied = new Date(action.applied_at).getTime();
  const dayMs = 86_400_000;
  const preFrom = new Date(applied - WINDOW_DAYS * dayMs).toISOString();
  const preTo = new Date(applied).toISOString();
  const postFrom = preTo;
  const postTo = new Date(applied + WINDOW_DAYS * dayMs).toISOString();

  const [vPre, pPre, vPost, pPost] = await Promise.all([
    countEvents(tenantId, action.target_id, "product_viewed", preFrom, preTo),
    countEvents(tenantId, action.target_id, "purchase_completed", preFrom, preTo),
    countEvents(tenantId, action.target_id, "product_viewed", postFrom, postTo),
    countEvents(tenantId, action.target_id, "purchase_completed", postFrom, postTo),
  ]);

  if (vPre < MIN_VIEWS_PRE) return null;
  const convPre = pPre / vPre;
  const convPost = vPost > 0 ? pPost / vPost : 0;
  if (convPre <= 0) return null;
  const ratio = convPost / convPre;
  if (ratio >= DROP_THRESHOLD) return null;

  // Get product name for friendly title
  const { data: product } = await supabaseAdmin
    .from("products")
    .select("name")
    .eq("id", action.target_id)
    .maybeSingle();
  const productName = product?.name ?? "product";

  const dropPct = Math.round((1 - ratio) * 100);
  const direction = newPrice > oldPrice ? "increase" : "decrease";
  const oldPriceFmt = (oldPrice / 100).toFixed(2);
  const newPriceFmt = (newPrice / 100).toFixed(2);

  return {
    tenant_id: tenantId,
    insight_type: "price_revert",
    affected_layer: "product",
    title: `Revert price on ${productName} — conversion dropped ${dropPct}%`,
    description: `After the price ${direction} from $${oldPriceFmt} to $${newPriceFmt}, conversion fell from ${(convPre * 100).toFixed(1)}% to ${(convPost * 100).toFixed(1)}% over ${WINDOW_DAYS} days. Recommend rollback to previous price.`,
    expected_impact: `Recover ~${dropPct}% conversion on ${productName}`,
    confidence: Math.min(0.95, 0.6 + (vPre + vPost) / 500),
    risk_level: "high",
    metrics: {
      product_id: action.target_id,
      source_action_id: action.id,
      // suggested_price_cents = old price (rollback) — reused by actions.apply
      suggested_price_cents: oldPrice,
      current_price_cents: newPrice,
      conversion_pre: convPre,
      conversion_post: convPost,
      drop_ratio: ratio,
      views_pre: vPre,
      views_post: vPost,
      purchases_pre: pPre,
      purchases_post: pPost,
      window_days: WINDOW_DAYS,
    },
    dedup_key: `revert::${action.id}`,
  };
}

export const Route = createFileRoute("/hooks/agents/price-revert")({
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
          const now = Date.now();
          const dayMs = 86_400_000;
          const minApplied = new Date(now - 30 * dayMs).toISOString();
          const maxApplied = new Date(now - WINDOW_DAYS * dayMs).toISOString();

          const { data: actions } = await supabaseAdmin
            .from("ai_actions")
            .select("id, applied_at, target_id, actual_result")
            .eq("tenant_id", tenantId)
            .eq("action_type", "update_price")
            .eq("status", "applied")
            .is("reverted_at", null)
            .not("target_id", "is", null)
            .gte("applied_at", minApplied)
            .lte("applied_at", maxApplied);

          const candidates: AgentInsightInput[] = [];
          for (const a of (actions ?? []) as PriceActionRow[]) {
            if (!a.applied_at || !a.target_id) continue;
            const insight = await analyzePriceAction(tenantId, a);
            if (insight) candidates.push(insight);
          }

          const created = await insertInsightsDedup(candidates);

          // Auto-apply: для кожного свіжого price_revert insight одразу викликаємо
          // actions.apply, щоб ціна реально відкотилася без участі власника.
          let autoApplied = 0;
          if (created > 0) {
            const dedupKeys = candidates.map((c) => `revert::${(c.metrics as { source_action_id?: string }).source_action_id}`);
            const { data: freshInsights } = await supabaseAdmin
              .from("ai_insights")
              .select("id, metrics")
              .eq("tenant_id", tenantId)
              .eq("insight_type", "price_revert")
              .eq("status", "new")
              .order("created_at", { ascending: false })
              .limit(candidates.length);
            const sourceIds = new Set(
              candidates.map((c) => (c.metrics as { source_action_id?: string }).source_action_id),
            );
            const origin = new URL(request.url).origin;
            for (const ins of freshInsights ?? []) {
              const sid = (ins.metrics as { source_action_id?: string } | null)?.source_action_id;
              if (!sid || !sourceIds.has(sid)) continue;
              try {
                const res = await fetch(`${origin}/hooks/actions/apply`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ insight_id: ins.id }),
                });
                if (res.ok) autoApplied++;
              } catch {
                // best-effort — наступний прогін cron повторить
              }
            }
          }

          await finishAgentRun(handle, created, {
            analyzed: actions?.length ?? 0,
            candidates: candidates.length,
            auto_applied: autoApplied,
          });
          return jsonOk({
            insights_created: created,
            analyzed: actions?.length ?? 0,
            candidates: candidates.length,
            auto_applied: autoApplied,
          });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Price revert agent failed", 500, { details: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  },
});
