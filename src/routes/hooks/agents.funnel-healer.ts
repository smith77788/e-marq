/**
 * Funnel Healer — рахує conversion rate на кожному кроці воронки
 * (page_view → product_view → add_to_cart → checkout_started → purchase_completed)
 * за останні 14 днів, знаходить найслабшу ланку і генерує insight.
 *
 * Слабка ланка = step з найбільшим drop-off pct, якщо вона нижча
 * за бенчмарк (product→cart <8%, cart→checkout <40%, checkout→purchase <60%).
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

const AGENT_ID = "funnel-healer";

const STEPS = [
  "session_start",
  "product_viewed",
  "add_to_cart",
  "checkout_started",
  "purchase_completed",
] as const;
type Step = (typeof STEPS)[number];

const BENCHMARKS: Record<string, number> = {
  "session_start->product_viewed": 0.25,
  "product_viewed->add_to_cart": 0.08,
  "add_to_cart->checkout_started": 0.4,
  "checkout_started->purchase_completed": 0.6,
};

const COPY: Record<string, { ua: string; en: string }> = {
  "session_start->product_viewed": {
    ua: "Заходять на сайт, але не клікають у картку товару. Перевір categories/збільш hero CTA.",
    en: "Visit the site but don't open product cards. Improve hero CTA / categories.",
  },
  "product_viewed->add_to_cart": {
    ua: "Дивляться картку, але не додають у кошик. Слабкі фото, опис або ціна.",
    en: "View product but don't add to cart. Weak photos, copy or price.",
  },
  "add_to_cart->checkout_started": {
    ua: "Додають у кошик, але не йдуть на checkout. Висока вартість доставки або страх форми.",
    en: "Add to cart but don't reach checkout. High shipping or scary form.",
  },
  "checkout_started->purchase_completed": {
    ua: "Доходять до checkout, але не оплачують. Bug в платіжці або немає потрібних методів.",
    en: "Reach checkout but don't pay. Payment bug or missing methods.",
  },
};

export const Route = createFileRoute("/hooks/agents/funnel-healer")({
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
          const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("events")
            .select("session_id, type")
            .eq("tenant_id", tenantId)
            .in("type", STEPS as unknown as Step[])
            .gte("created_at", since)
            .not("session_id", "is", null)
            .limit(100_000);
          if (error) throw error;
          const events = data ?? [];
          if (events.length < 50) {
            await finishAgentRun(handle, 0, { events: events.length, reason: "insufficient_data" });
            return jsonOk({ run_id: handle.runId, events: events.length, insights_created: 0 });
          }

          // Per-session step set
          const reached = new Map<string, Set<Step>>();
          for (const e of events) {
            if (!e.session_id) continue;
            const s = reached.get(e.session_id) ?? new Set<Step>();
            s.add(e.type as Step);
            reached.set(e.session_id, s);
          }

          const counts: Record<Step, number> = {
            session_start: 0,
            product_viewed: 0,
            add_to_cart: 0,
            checkout_started: 0,
            purchase_completed: 0,
          };
          for (const set of reached.values()) {
            for (const step of STEPS) if (set.has(step)) counts[step]++;
          }

          // Compute conversion rates between adjacent steps
          const rates: Record<string, { rate: number; from: number; to: number }> = {};
          for (let i = 0; i < STEPS.length - 1; i++) {
            const from = STEPS[i];
            const to = STEPS[i + 1];
            const key = `${from}->${to}`;
            const fromCnt = counts[from];
            const toCnt = counts[to];
            rates[key] = {
              rate: fromCnt > 0 ? toCnt / fromCnt : 0,
              from: fromCnt,
              to: toCnt,
            };
          }

          // Find weakest step below benchmark
          const insights: AgentInsightInput[] = [];
          let worst: { key: string; gap: number } | null = null;
          for (const [key, info] of Object.entries(rates)) {
            const benchmark = BENCHMARKS[key] ?? 0.1;
            if (info.from < 20) continue; // need volume
            const gap = benchmark - info.rate;
            if (gap > 0 && (!worst || gap > worst.gap)) {
              worst = { key, gap };
            }
          }
          if (worst) {
            const info = rates[worst.key];
            const benchmark = BENCHMARKS[worst.key];
            const copy = COPY[worst.key];
            const recoverable = Math.round((benchmark - info.rate) * info.from);
            insights.push({
              tenant_id: tenantId,
              insight_type: "funnel_weak_step",
              affected_layer: "conversion",
              title: `Воронка тече: ${worst.key} = ${(info.rate * 100).toFixed(1)}% (норма ${(benchmark * 100).toFixed(0)}%)`,
              description: copy?.ua ?? "Слабка ланка у воронці продажів.",
              expected_impact: `Підняття до бенчмарку дасть ~${recoverable} додаткових клієнтів далі по воронці за 14 днів.`,
              confidence: 0.75,
              risk_level: "high",
              metrics: {
                weak_step: worst.key,
                rate: info.rate,
                benchmark,
                from_count: info.from,
                to_count: info.to,
                potential_recoverable: recoverable,
                full_funnel: rates,
                copy_ua: copy?.ua,
                copy_en: copy?.en,
                suggested_action: `fix_${worst.key.replace(/->/g, "_to_")}`,
              },
              dedup_key: `funnel_weak::${worst.key}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { funnel: rates, sessions: reached.size });
          return jsonOk({
            run_id: handle.runId,
            sessions: reached.size,
            funnel: rates,
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
