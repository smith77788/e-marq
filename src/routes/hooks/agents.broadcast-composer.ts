/**
 * Broadcast Composer — пропонує тематичний broadcast на основі ситуації:
 *   - є товар з падінням стоку → "залишилось мало"
 *   - є новий товар (created < 7d, ще нема замовлень) → "знайомство"
 *   - є сегмент з 50+ клієнтів без активності 30 днів → "ми сумуємо"
 * Генерує insight з готовим draft body (UA/EN), щоб власник просто approved → engine розсилає.
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

const AGENT_ID = "broadcast-composer";

export const Route = createFileRoute("/hooks/agents/broadcast-composer")({
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
          const insights: AgentInsightInput[] = [];

          // Theme 1: low-stock urgency on a popular product
          const { data: lowStock } = await supabaseAdmin
            .from("products")
            .select("id, name, stock, price_cents")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .gt("stock", 0)
            .lte("stock", 10)
            .order("stock", { ascending: true })
            .limit(1);
          if (lowStock?.length) {
            const p = lowStock[0];
            insights.push({
              tenant_id: tenantId,
              insight_type: "broadcast_suggestion",
              affected_layer: "marketing",
              title: `Розсилка: "${p.name}" — залишилось ${p.stock} шт.`,
              description: `Сильний привід для urgency-броадкасту. Готовий драфт на 1-2 речення нижче.`,
              expected_impact: `Urgency-розсилки конвертять у 2-3× краще ніж evergreen.`,
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                theme: "urgency_low_stock",
                product_id: p.id,
                product_name: p.name,
                stock: p.stock,
                draft_ua: `🔥 ${p.name} — залишилось лише ${p.stock} шт. Хто давно дивився — час брати.`,
                draft_en: `🔥 ${p.name} — only ${p.stock} left. If you've been thinking about it, now's the time.`,
                suggested_action: "send_broadcast",
              },
              dedup_key: `broadcast::lowstock::${p.id}`,
            });
          }

          // Theme 2: new product with no orders yet
          const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
          const { data: newProds } = await supabaseAdmin
            .from("products")
            .select("id, name, price_cents, created_at")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .gte("created_at", sevenDaysAgo)
            .limit(5);
          for (const p of newProds ?? []) {
            const { count } = await supabaseAdmin
              .from("order_items")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .eq("product_id", p.id);
            if ((count ?? 0) === 0) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "broadcast_suggestion",
                affected_layer: "marketing",
                title: `Розсилка: знайомство з "${p.name}"`,
                description: `Новинка без жодного продажу — потрібен імпульс. Драфт нижче.`,
                expected_impact: `Welcome-broadcast у тиждень запуску дає 5-15% перших продажів.`,
                confidence: 0.65,
                risk_level: "low",
                metrics: {
                  theme: "new_product_intro",
                  product_id: p.id,
                  product_name: p.name,
                  draft_ua: `✨ Новинка: ${p.name}. Зробили те, що давно просили — глянь та скажи що думаєш.`,
                  draft_en: `✨ Just launched: ${p.name}. We made what you've been asking for — take a look and tell us what you think.`,
                  suggested_action: "send_broadcast",
                },
                dedup_key: `broadcast::newprod::${p.id}`,
              });
              break; // one per run
            }
          }

          // Theme 3: dormant segment (no activity 30+ days)
          const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
          const { count: dormantCount } = await supabaseAdmin
            .from("customers")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("consent_marketing", true)
            .gte("total_orders", 1)
            .lte("last_order_at", thirtyDaysAgo);
          if ((dormantCount ?? 0) >= 50) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "broadcast_suggestion",
              affected_layer: "marketing",
              title: `Розсилка: ${dormantCount} клієнтів сплять >30 днів`,
              description: `Великий спячий сегмент — ідеальний для re-engagement з персональним меседжем.`,
              expected_impact: `Re-engagement броадкасти будять ~6-10% сплячих.`,
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                theme: "dormant_reengagement",
                customer_count: dormantCount,
                draft_ua: `Привіт! Ми тут зробили дещо нове — і подумали про тебе. Подивись, може щось приглянеться 👀`,
                draft_en: `Hey! We've been working on some new things — and thought of you. Take a peek 👀`,
                suggested_action: "send_broadcast",
              },
              dedup_key: `broadcast::dormant::${Math.floor(Date.now() / (7 * 86_400_000))}::${dormantCount}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { themes: insights.length });
          return jsonOk({
            run_id: handle.runId,
            themes: insights.length,
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
