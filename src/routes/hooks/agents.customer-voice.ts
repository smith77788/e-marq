/**
 * Bootstrap Agent: Customer Voice Miner
 *
 * Аналізує conversations + social_proof_events щоб виділити «голос клієнта»:
 *   - топ-фрази, які кажуть клієнти
 *   - середній рейтинг (з social_proof_events.metadata.rating)
 *   - частоту згадування ключових тем (швидкість, ціна, якість, сервіс)
 *   - тон (позитив/негатив за простими маркерами)
 * Пише в bootstrap_facts(customer_voice) — використовується broadcast-composer,
 * seo-rewriter, ugc-harvester для генерації автентичних текстів.
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
import { upsertBootstrapFacts } from "@/lib/acos/bootstrapFacts";

const AGENT_ID = "customer_voice_miner";

const POSITIVE = [
  "дякую",
  "супер",
  "класно",
  "круто",
  "чудово",
  "люблю",
  "thanks",
  "love",
  "great",
  "perfect",
  "amazing",
];
const NEGATIVE = [
  "погано",
  "повільно",
  "дорого",
  "зламано",
  "не приїхало",
  "slow",
  "broken",
  "bad",
  "expensive",
  "late",
];
const TOPICS = {
  speed: ["швидко", "швидкість", "доставка", "fast", "delivery", "shipping"],
  price: ["ціна", "дорого", "дешево", "price", "cost", "expensive", "cheap"],
  quality: ["якість", "якісно", "смак", "свіжо", "quality", "fresh", "taste"],
  service: ["сервіс", "відповідь", "підтримка", "support", "service", "response"],
};

export const Route = createFileRoute("/hooks/agents/customer-voice")({
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
          const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
          const [convRes, proofRes] = await Promise.all([
            supabaseAdmin
              .from("conversations")
              .select("body, direction")
              .eq("tenant_id", tenantId)
              .eq("direction", "inbound")
              .gte("created_at", since)
              .limit(1000),
            supabaseAdmin
              .from("social_proof_events")
              .select("display_text, metadata")
              .eq("tenant_id", tenantId)
              .gte("created_at", since)
              .limit(500),
          ]);

          const allTexts: string[] = [];
          for (const c of convRes.data ?? []) if (c.body) allTexts.push(c.body);
          let ratingSum = 0;
          let ratingCount = 0;
          for (const p of proofRes.data ?? []) {
            if (p.display_text) allTexts.push(p.display_text);
            const meta = (p.metadata ?? {}) as Record<string, unknown>;
            if (typeof meta.rating === "number") {
              ratingSum += meta.rating;
              ratingCount++;
            }
          }

          const lower = allTexts.map((t) => t.toLowerCase());
          let positive = 0;
          let negative = 0;
          const topicHits: Record<string, number> = { speed: 0, price: 0, quality: 0, service: 0 };
          const phraseFreq = new Map<string, number>();

          for (const text of lower) {
            for (const w of POSITIVE) if (text.includes(w)) positive++;
            for (const w of NEGATIVE) if (text.includes(w)) negative++;
            for (const [topic, words] of Object.entries(TOPICS)) {
              for (const w of words) if (text.includes(w)) topicHits[topic]++;
            }
            // витягнемо короткі фрази 3-7 слів між знаками
            const segments = text.split(/[.!?,;\n]+/).filter((s) => s.trim().length > 0);
            for (const seg of segments) {
              const trimmed = seg.trim();
              const wc = trimmed.split(/\s+/).length;
              if (wc >= 3 && wc <= 7 && trimmed.length < 80) {
                phraseFreq.set(trimmed, (phraseFreq.get(trimmed) ?? 0) + 1);
              }
            }
          }

          const topPhrases = Array.from(phraseFreq.entries())
            .filter(([, n]) => n >= 2)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([phrase, count]) => ({ phrase, count }));

          const sentiment =
            positive + negative === 0 ? 0 : (positive - negative) / (positive + negative);
          const avgRating = ratingCount > 0 ? ratingSum / ratingCount : null;

          await upsertBootstrapFacts([
            {
              tenant_id: tenantId,
              fact_kind: "customer_voice",
              value: {
                samples_total: allTexts.length,
                sentiment_score: Number(sentiment.toFixed(3)),
                avg_rating: avgRating,
                rating_count: ratingCount,
                top_topics: topicHits,
                top_phrases: topPhrases,
                positive_hits: positive,
                negative_hits: negative,
              },
              confidence: allTexts.length >= 10 ? 0.85 : allTexts.length >= 3 ? 0.55 : 0.3,
              evidence: {
                conversations: convRes.data?.length ?? 0,
                social_proof: proofRes.data?.length ?? 0,
              },
            },
          ]);

          const insights: AgentInsightInput[] = [];
          if (allTexts.length === 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_no_customer_voice",
              affected_layer: "crm",
              title: "Ще немає повідомлень від клієнтів",
              description:
                "Без розмов із клієнтами агенти broadcast-composer і seo-rewriter пишуть нейтральні шаблонні тексти. Активуйте Telegram-бота та збирайте відгуки — це різко підвищить якість автоматичних повідомлень.",
              expected_impact: "Дозволяє agent-ам говорити голосом ваших клієнтів",
              confidence: 0.85,
              risk_level: "medium",
              metrics: { samples: 0, action: "activate_telegram_bot" },
              dedup_key: "no_customer_voice",
            });
          } else if (sentiment < -0.3 && allTexts.length >= 10) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_negative_voice",
              affected_layer: "crm",
              title: "Тренд настроїв клієнтів — негативний",
              description: `За останні 90 днів негативних згадок ${negative} проти ${positive} позитивних (${allTexts.length} повідомлень). Перегляньте топ-теми проблем та запустіть csat-dispatcher.`,
              expected_impact: "Захищає від втрати лояльних клієнтів",
              confidence: 0.8,
              risk_level: "high",
              metrics: { sentiment, positive, negative, action: "review_csat" },
              dedup_key: "negative_voice",
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            samples: allTexts.length,
            sentiment,
            avg_rating: avgRating,
          });
          return jsonOk({
            run_id: handle.runId,
            insights_created: created,
            samples: allTexts.length,
            sentiment,
            avg_rating: avgRating,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Customer voice miner failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
