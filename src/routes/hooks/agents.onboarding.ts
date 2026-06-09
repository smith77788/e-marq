/**
 * ACOS Agent: Onboarding/Setup Coach
 *
 * Створює insights-підказки на ранніх стадіях життя tenant, коли інші агенти
 * ще не мають даних щоб щось знайти (немає paid orders, немає трафіку, немає бота).
 * Це гарантує що кожен бізнес побачить корисні рекомендації від першого дня.
 *
 * Перевіряє:
 *  - чи є товари (>=3 для нормальної воронки)
 *  - чи є paid orders (=0 → "перший продаж" блокер)
 *  - чи підв'язаний Telegram (telegram_chat_routing для tenant)
 *  - чи є tracking events за останні 7 днів
 *  - чи зібрані customer emails (для winback/reorder)
 *  - чи увімкнено реальний платіжний метод (метаданих stripe в tenant_configs)
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

const AGENT_ID = "onboarding_coach";

export const Route = createFileRoute("/hooks/agents/onboarding")({
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
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

          const [
            tenantRes,
            productsRes,
            ordersAllRes,
            ordersPaidRes,
            customersRes,
            customersWithEmailRes,
            eventsRes,
            tgRoutingRes,
            cfgRes,
          ] = await Promise.all([
            supabaseAdmin.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle(),
            supabaseAdmin
              .from("products")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .eq("is_active", true),
            supabaseAdmin
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId),
            supabaseAdmin
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .in("status", ["paid", "fulfilled"]),
            supabaseAdmin
              .from("customers")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId),
            supabaseAdmin
              .from("customers")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .not("email", "is", null),
            supabaseAdmin
              .from("events")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .gte("created_at", sevenDaysAgo),
            supabaseAdmin
              .from("telegram_chat_routing")
              .select("chat_id", { count: "exact", head: true })
              .eq("tenant_id", tenantId),
            supabaseAdmin
              .from("tenant_configs")
              .select("features, bot")
              .eq("tenant_id", tenantId)
              .maybeSingle(),
          ]);

          const productCount = productsRes.count ?? 0;
          const ordersAll = ordersAllRes.count ?? 0;
          const ordersPaid = ordersPaidRes.count ?? 0;
          const customers = customersRes.count ?? 0;
          const customersWithEmail = customersWithEmailRes.count ?? 0;
          const events7d = eventsRes.count ?? 0;
          const tgChats = tgRoutingRes.count ?? 0;
          const features = (cfgRes.data?.features ?? {}) as Record<string, unknown>;
          const stripeOn = features.payments_stripe === true || features.stripe === true;

          const brand = tenantRes.data?.name ?? "your brand";
          const slug = tenantRes.data?.slug ?? "";

          const insights: AgentInsightInput[] = [];

          // 1. Каталог пустий або тонкий
          if (productCount === 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "setup_no_products",
              affected_layer: "catalog",
              title: "Каталог порожній — додайте перший товар",
              description: `У ${brand} немає активних товарів. Додайте хоча б 3 SKU, щоб клієнти (і бот) мали що купити.`,
              expected_impact: "Активує всі інші MARQ-агенти",
              confidence: 1,
              risk_level: "high",
              metrics: { product_count: productCount, action: "open_catalog", min_recommended: 3 },
              dedup_key: "no_products",
            });
          } else if (productCount < 3) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "setup_thin_catalog",
              affected_layer: "catalog",
              title: `Лише ${productCount} активних товари — додайте ще 2-3`,
              description: `Магазини з 3+ SKU мають ~2× вищий середній чек завдяки перехресному продажу. Зараз у вас ${productCount}.`,
              expected_impact: "Відкриває AOV-оптимізатор і бандлові рекомендації",
              confidence: 0.9,
              risk_level: "medium",
              metrics: { product_count: productCount, action: "open_catalog", min_recommended: 3 },
              dedup_key: "thin_catalog",
            });
          }

          // 2. Жодних замовлень
          if (productCount > 0 && ordersAll === 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "setup_no_orders",
              affected_layer: "growth",
              title: "Ще жодного замовлення — залучте першого покупця",
              description: `Каталог активний, але ніхто ще не оформив замовлення. Поділіться посиланням на вітрину (/s/${slug}) у соцмережах або розішліть наявним клієнтам.`,
              expected_impact: "Перше оплачене замовлення активує агентів утримання і повернення",
              confidence: 1,
              risk_level: "high",
              metrics: { products: productCount, slug, action: "share_storefront" },
              dedup_key: "no_orders",
            });
          }

          // 3. Замовлення є, але жодного paid
          if (ordersAll > 0 && ordersPaid === 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "setup_pending_only",
              affected_layer: "checkout",
              title: `${ordersAll} замовлень очікують оплати — жодне не сплачено`,
              description: `Клієнти додали товари до кошика, але не завершили оплату. Найчастіша причина: не підключений платіжний шлюз (LiqPay / WayForPay / Monobank).`,
              expected_impact: "Підключіть платіжний шлюз для автоматичного переведення у статус «Оплачено»",
              confidence: 0.85,
              risk_level: "high",
              metrics: {
                pending: ordersAll,
                paid: ordersPaid,
                stripe_on: stripeOn,
                action: "enable_stripe",
              },
              dedup_key: "pending_only",
            });
          }

          // 4. Telegram не підв'язаний
          if (tgChats === 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "setup_no_telegram",
              affected_layer: "channels",
              title: "Telegram-бот не підключений до жодного чату",
              description: `Надішліть /start ${slug} до @Oauther_bot з вашого телефону, щоб прив'язати канал. Без цього агенти повернення і нагадування не можуть зв'язатись з клієнтами.`,
              expected_impact: "Активує sales-бота 24/7, нагадування про поповнення та winback DM",
              confidence: 1,
              risk_level: "high",
              metrics: {
                slug,
                deep_link: `https://t.me/Oauther_bot?start=${slug}`,
                action: "connect_telegram",
              },
              dedup_key: "no_telegram",
            });
          }

          // 5. Tracking не встановлений
          if (events7d === 0 && productCount > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "setup_no_tracking",
              affected_layer: "analytics",
              title: "Немає подій сайту за 7 днів",
              description: `Без трекінгу ми не бачимо, які товари переглядають клієнти, де виходять і що рекомендувати. Вставте 1-рядковий сніпет відстеження на ваш сайт.`,
              expected_impact: "Розблоковує агентів пошуку прогалин, AOV-leak і якості бота",
              confidence: 0.95,
              risk_level: "medium",
              metrics: { events_7d: 0, action: "show_tracking_snippet", slug },
              dedup_key: "no_tracking",
            });
          }

          // 6. Customers без email
          if (customers > 0 && customersWithEmail === 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "setup_no_emails",
              affected_layer: "crm",
              title: `${customers} клієнтів без email-адреси`,
              description: `Без email агенти повернення і відновлення кошика можуть зв'язатись лише через Telegram. Додайте поле email до оформлення замовлення.`,
              expected_impact: "Подвоює охоплену аудиторію для вихідних кампаній",
              confidence: 0.9,
              risk_level: "medium",
              metrics: { customers, with_email: 0, action: "edit_checkout_form" },
              dedup_key: "no_emails",
            });
          }

          // 7. Перший paid order — святкуємо і даємо growth-рекомендацію
          if (ordersPaid === 1) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "milestone_first_sale",
              affected_layer: "growth",
              title: "🎉 Перше оплачене замовлення — час масштабуватись",
              description: `Перший продаж відбувся. Увімкніть автоматизацію: Telegram-бот, повернення кошиків і нагадування про поповнення. MARQ-агенти почнуть знаходити патерни при ~5+ замовленнях.`,
              expected_impact: "Кожне нове замовлення робить агентів розумнішими",
              confidence: 1,
              risk_level: "low",
              metrics: { orders_paid: 1, action: "review_setup_checklist" },
              dedup_key: "milestone_first_sale",
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            product_count: productCount,
            orders_all: ordersAll,
            orders_paid: ordersPaid,
            customers,
            customers_with_email: customersWithEmail,
            events_7d: events7d,
            tg_chats: tgChats,
            stripe_on: stripeOn,
            candidates: insights.length,
          });
          return jsonOk({
            run_id: handle.runId,
            insights_created: created,
            checks: {
              products: productCount,
              orders_paid: ordersPaid,
              telegram_chats: tgChats,
              events_7d: events7d,
            },
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Onboarding agent failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
