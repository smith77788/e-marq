/**
 * Bootstrap Agent: Integration Scout
 *
 * Сканує які зовнішні системи ймовірно потрібні бренду на основі:
 *   - наявних tenant_integrations (що вже підключено)
 *   - обсягу замовлень (>50/тиждень → POS-інтеграція принесе цінність)
 *   - кількості SKU (>30 → потрібна warehouse/inventory інтеграція)
 *   - наявності email/telegram (визначає рекомендований ESP)
 *
 * Створює insights з покроковими підказками для власника, які саме
 * connector-и підключити, з посиланнями на /brand/integrations.
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

const AGENT_ID = "integration_scout";

export const Route = createFileRoute("/hooks/agents/integration-scout")({
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
          const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

          const [intRes, ordersRes, productsRes, customersEmailRes] = await Promise.all([
            supabaseAdmin
              .from("tenant_integrations")
              .select("provider, is_active")
              .eq("tenant_id", tenantId),
            supabaseAdmin
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .eq("status", "paid")
              .gte("created_at", since30),
            supabaseAdmin
              .from("products")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .eq("is_active", true),
            supabaseAdmin
              .from("customers")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .not("email", "is", null),
          ]);

          const integrations = intRes.data ?? [];
          const have = new Set(integrations.filter((i) => i.is_active).map((i) => i.provider));
          const ordersMonthly = ordersRes.count ?? 0;
          const productCount = productsRes.count ?? 0;
          const emailCustomers = customersEmailRes.count ?? 0;

          const recommendations: Array<{
            kind: string;
            reason: string;
            action: string;
            priority: "high" | "medium" | "low";
          }> = [];

          // 1. POS / inventory: для високого обороту
          if (ordersMonthly >= 30 && !have.has("dntrade") && !have.has("shopify")) {
            recommendations.push({
              kind: "pos_inventory",
              reason: `${ordersMonthly} оплачених замовлень за 30 днів — ручне ведення складу буде помилятися.`,
              action: "Підключіть DN-Trade або Shopify через /brand/integrations",
              priority: "high",
            });
          }
          if (productCount >= 30 && !have.has("dntrade") && !have.has("shopify")) {
            recommendations.push({
              kind: "catalog_sync",
              reason: `${productCount} активних SKU — варто синхронізувати з POS, щоб ціни/залишки не розходились.`,
              action: "Налаштуйте webhook DN-Trade або імпорт Shopify",
              priority: "medium",
            });
          }
          // 2. Email ESP
          if (emailCustomers >= 50 && !have.has("resend") && !have.has("mailchimp")) {
            recommendations.push({
              kind: "email_esp",
              reason: `${emailCustomers} клієнтів з email — без ESP розсилки впадуть у спам.`,
              action: "Підключіть Resend (вбудований) або Mailchimp",
              priority: "high",
            });
          }
          // 3. Аналітика
          if (ordersMonthly >= 5 && !have.has("ga4") && !have.has("plausible")) {
            recommendations.push({
              kind: "analytics",
              reason: "Без зовнішньої аналітики складно атрибутувати трафік.",
              action: "Додайте GA4 або Plausible",
              priority: "low",
            });
          }

          await upsertBootstrapFacts([
            {
              tenant_id: tenantId,
              fact_kind: "integration_inventory",
              value: {
                connected: Array.from(have),
                inactive: integrations.filter((i) => !i.is_active).map((i) => i.provider),
                recommendations,
                signals: {
                  orders_30d: ordersMonthly,
                  products_active: productCount,
                  customers_email: emailCustomers,
                },
              },
              confidence: 0.9,
            },
          ]);

          const insights: AgentInsightInput[] = recommendations.map((r) => ({
            tenant_id: tenantId,
            insight_type: `bootstrap_recommend_${r.kind}`,
            affected_layer: "integrations",
            title: `Рекомендація: ${r.kind.replace(/_/g, " ")}`,
            description: `${r.reason} ${r.action}`,
            expected_impact: "Розблоковує точніші дані для усіх агентів",
            confidence: 0.8,
            risk_level: r.priority,
            metrics: { kind: r.kind, action: "open_integrations", priority: r.priority },
            dedup_key: `recommend_${r.kind}`,
          }));

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            connected: Array.from(have).length,
            recommendations: recommendations.length,
          });
          return jsonOk({
            run_id: handle.runId,
            insights_created: created,
            connected: Array.from(have),
            recommendations,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Integration scout failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
