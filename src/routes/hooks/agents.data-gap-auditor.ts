/**
 * Bootstrap Agent: Data Gap Auditor
 *
 * Мета-агент: дивиться на bootstrap_facts усіх інших розвідників і будує
 * читабельний звіт про прогалини. Створює один summary insight з
 * пріоритезованим списком дій для власника.
 *
 * Це той агент, який власник бачить першим у списку — він говорить
 * "ось що блокує точну роботу системи й ось що зробити".
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
import { readBootstrapFact, upsertBootstrapFacts } from "@/lib/acos/bootstrapFacts";

const AGENT_ID = "data_gap_auditor";

type ChannelInventory = {
  storefront?: { ready?: boolean };
  telegram?: { ready?: boolean };
  email?: { ready?: boolean };
};
type CatalogQuality = {
  products_total?: number;
  missing_description?: number;
  missing_image?: number;
  missing_cost?: number;
  completeness_score?: number;
};
type MarginSummary = { measured_count?: number; estimated_count?: number };
type CustomerVoice = { samples_total?: number; sentiment_score?: number };
type BrandProfile = { description?: string | null; categories?: string[] };

export const Route = createFileRoute("/hooks/agents/data-gap-auditor")({
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
          const [profile, catalog, margin, voice, channels] = await Promise.all([
            readBootstrapFact<BrandProfile>(tenantId, "brand_profile"),
            readBootstrapFact<CatalogQuality>(tenantId, "catalog_quality"),
            readBootstrapFact<MarginSummary>(tenantId, "margin_summary"),
            readBootstrapFact<CustomerVoice>(tenantId, "customer_voice"),
            readBootstrapFact<ChannelInventory>(tenantId, "channel_inventory"),
          ]);

          const gaps: Array<{ key: string; weight: number; label: string; how: string }> = [];

          if (!profile?.description) {
            gaps.push({
              key: "brand_description",
              weight: 3,
              label: "Опис бренду відсутній",
              how: "Brand Settings → SEO → додайте 2-3 речення",
            });
          }
          if (!profile?.categories?.length) {
            gaps.push({
              key: "product_categories",
              weight: 4,
              label: "Товари без категорій",
              how: "Каталог → Edit product → Category",
            });
          }
          if ((catalog?.missing_cost ?? 0) > 0) {
            gaps.push({
              key: "cost_prices",
              weight: 5,
              label: `Собівартість відсутня у ${catalog?.missing_cost} товарів`,
              how: "Каталог → Edit product → metadata.cost_cents",
            });
          }
          if ((catalog?.missing_description ?? 0) > 0) {
            gaps.push({
              key: "product_descriptions",
              weight: 3,
              label: `Опис відсутній у ${catalog?.missing_description} товарів`,
              how: "Каталог → Edit product → Description",
            });
          }
          if ((catalog?.missing_image ?? 0) > 0) {
            gaps.push({
              key: "product_images",
              weight: 4,
              label: `Зображення відсутнє у ${catalog?.missing_image} товарів`,
              how: "Каталог → Edit product → Image URL",
            });
          }
          if ((margin?.measured_count ?? 0) === 0) {
            gaps.push({
              key: "margin_known",
              weight: 5,
              label: "Реальна маржа невідома (тільки оцінка)",
              how: "Заповніть cost_cents у metadata кожного SKU",
            });
          }
          if (!channels?.telegram?.ready) {
            gaps.push({
              key: "telegram_channel",
              weight: 5,
              label: "Telegram-канал не підключено",
              how: "Brand Settings → Channels → Connect Telegram",
            });
          }
          if (!channels?.email?.ready) {
            gaps.push({
              key: "email_channel",
              weight: 3,
              label: "Email-адреси клієнтів не зібрано",
              how: "Додайте поле email у форму checkout",
            });
          }
          if ((voice?.samples_total ?? 0) < 10) {
            gaps.push({
              key: "customer_voice",
              weight: 2,
              label: "Голос клієнта майже не зібрано",
              how: "Активуйте Telegram-бот і збирайте відгуки",
            });
          }

          gaps.sort((a, b) => b.weight - a.weight);

          const totalWeight = gaps.reduce((s, g) => s + g.weight, 0);
          const maxWeight = 34; // сума усіх ваг вище
          const readinessScore = Math.max(0, 1 - totalWeight / maxWeight);

          await upsertBootstrapFacts([
            {
              tenant_id: tenantId,
              fact_kind: "data_gaps",
              value: {
                gaps,
                gap_count: gaps.length,
                total_weight: totalWeight,
                readiness_score: Number(readinessScore.toFixed(3)),
                computed_at: new Date().toISOString(),
              },
              confidence: 0.95,
            },
          ]);

          const insights: AgentInsightInput[] = [];
          if (gaps.length > 0) {
            const top3 = gaps.slice(0, 3);
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_data_gaps_summary",
              affected_layer: "setup",
              title: `Знайдено ${gaps.length} прогалин — ${(readinessScore * 100).toFixed(0)}% готовності`,
              description:
                `Топ-${top3.length} критичних:\n` +
                top3.map((g, i) => `${i + 1}. ${g.label} → ${g.how}`).join("\n") +
                `\n\nКоли заповните усі — точність агентів зросте на ~${Math.round((1 - readinessScore) * 60)}%.`,
              expected_impact: "Розблоковує повну точність 65+ робочих агентів",
              confidence: 0.95,
              risk_level: gaps.length >= 5 ? "high" : gaps.length >= 2 ? "medium" : "low",
              metrics: {
                gap_count: gaps.length,
                readiness_score: readinessScore,
                top_gaps: top3.map((g) => g.key),
                action: "open_setup_checklist",
              },
              dedup_key: "data_gaps_summary",
            });
          } else {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_all_ready",
              affected_layer: "setup",
              title: "🎯 Усі дані зібрано — агенти працюють на повну",
              description: "Профіль бренду, маржі, канали та голос клієнта в системі. Немає блокерів для агентів.",
              expected_impact: "Точність ШІ-рекомендацій максимальна",
              confidence: 1,
              risk_level: "low",
              metrics: { readiness_score: 1, gap_count: 0 },
              dedup_key: "all_ready",
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            gap_count: gaps.length,
            readiness_score: readinessScore,
          });
          return jsonOk({
            run_id: handle.runId,
            insights_created: created,
            gap_count: gaps.length,
            readiness_score: readinessScore,
            gaps,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Data gap auditor failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
