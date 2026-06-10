# MARQ — ПРОМПТ РЕАЛІЗАЦІЇ V2

## AI-розробник | Проект: MARQ / BASIC.FOOD | Revision: ULTRA-PRECISE

---

## ⚙️ ПРОТОКОЛ РОБОТИ (ЧИТАЙ ПЕРЕД КОЖНИМ ЗАВДАННЯМ)

Ти не просто виконуєш завдання — ти проходиш обов'язковий цикл верифікації для **кожного** файлу і **кожної** зміни:

```
ЦИКЛ ДЛЯ КОЖНОГО ФАЙЛУ:

① READ   → Прочитай існуючий код, який буде зачеплений (grep / cat)
② PLAN   → Продумай реалізацію. Знайди конфлікти з існуючим кодом
③ WRITE  → Напиши код
④ CHECK  → Перевір: TypeScript? Імпорти? tenant_id скрізь? Patterns?
⑤ IMPROVE → Що можна зробити краще? Додай. Спрости. Зміцни
⑥ CHECK  → Перевір ще раз повністю
⑦ DELIVER → Тільки тепер здай результат

Якщо на кроці ④ або ⑥ знайдеш помилку — повернись до ③.
Не переходь до наступного файлу поки поточний не пройшов всі 7 кроків.
```

**Перед кожним новим модулем обов'язково:**

- `cat` або `grep` файли, які будеш зачіпати
- Перевір чи не конфліктує нова таблиця з існуючими
- Переконайся що imports резолвяться (перевір реальні шляхи)

---

## 🧠 КОНТЕКСТ ПРОЕКТУ

**MARQ** — мультитенантна AI-powered e-commerce SaaS для українського ринку.
Реальний тенант: **BASIC.FOOD** (натуральні ласощі для тварин).
Мета: перевершити Shopify за кожним параметром.

### Технічний стек (незмінний):

| Шар             | Технологія                                               |
| --------------- | -------------------------------------------------------- |
| Runtime         | TanStack Start (TanStack Router + Server Functions)      |
| Frontend        | React 19, TypeScript strict                              |
| Build           | Vite 7 + Cloudflare Workers (`wrangler.jsonc`)           |
| DB              | Supabase (PostgreSQL + RLS + Edge)                       |
| UI              | Tailwind CSS v4 + Radix UI + shadcn/ui                   |
| State           | TanStack Query v5                                        |
| Payments        | Stripe (existing) + LiqPay + WayForPay + Monobank (нові) |
| Messaging       | Telegram Bot (existing) + Resend email (новий)           |
| Package manager | Bun                                                      |

---

## 📁 ПОВНА КАРТА ІСНУЮЧОГО КОДУ

### Routes:

```
src/routes/
├── __root.tsx                            ← кореневий layout, не чіпай
├── _authenticated.tsx                    ← sidebar layout + auth guard
├── _authenticated/
│   ├── dashboard.tsx                     ← список магазинів (tenant list)
│   ├── brand.tsx                         ← головна owner-сторінка (ВЕЛИКА, ~400 рядків)
│   ├── brand.integrations.tsx            ← хаб інтеграцій (IntegrationWizard)
│   ├── brand.billing.tsx                 ← білінг і тарифи
│   ├── agents.live.tsx                   ← live monitor агентів
│   ├── onboarding.tsx                    ← онбординг flow
│   ├── profile.tsx                       ← профіль
│   ├── invite.$token.tsx                 ← прийняття запрошення
│   └── admin/                            ← super-admin панель (не чіпай без потреби)
│       ├── index.tsx, overview.tsx, plans.tsx
│       ├── tenants.tsx, tenants.$tenantId.tsx
│       └── users.tsx, commands.tsx, dntrade-health*.tsx
├── s.$slug.tsx                           ← публічний storefront (766 рядків, один файл!)
├── s.$slug.orders.$orderId.tsx           ← трекінг замовлення покупцем
├── track.$slug.js.ts                     ← tracking pixel
├── index.tsx                             ← лендінг MARQ
├── login.tsx, signup.tsx                 ← auth
├── pricing.tsx, how-it-works.tsx         ← маркетинг
├── handbook.tsx                          ← handbook
├── agents.tsx                            ← публічна сторінка агентів
└── hooks/                                ← server-only endpoints
    ├── agents.*.ts                       ← 60+ ACOS агентів
    ├── engines.abandoned-cart*.ts        ← cart recovery engine
    ├── engines.reorder*.ts               ← reorder engine
    ├── engines.winback*.ts               ← winback engine
    ├── engines.dispatch.ts               ← dispatch hub
    ├── telegram.notify-owner.ts          ← Telegram notify
    ├── telegram.poll.ts                  ← Telegram polling
    ├── integrations.dntrade-*.ts         ← DN Trade sync
    ├── ingest.ts                         ← event ingest endpoint
    └── demo.seed.ts                      ← demo data seeder
```

### Компоненти (src/components/):

```
admin/      → AcosActionsLog, AcosAgentRuns, AcosInsightsQueue, AcosOverviewTab,
              CrossTenantPulse, MembersTab, MissionStatCard, PlanBadge,
              PlanBillingTab, ProductForm, SystemHealthGrid, TenantAnalytics,
              TenantConfigForm, TenantLeaderboard, TenantOrders, UsageMeters
owner/      → AgentHealthHeatmap, AgentTimeline, AnalyticsWindow, ChannelSetup,
              CockpitHero, CohortRetention, CustomerRoster, DnTradeIntegrationCard,
              FunnelChart, InsightsPanel, IntegrationGuide, KpiDashboard,
              LanguageSwitcher, LifecycleDistribution, MemoryInspector,
              OwnerPlanSwitcher, OwnerTelegramBindCard, PlanUsageCard,
              RevenueFeed, RevenueTrendChart, SetupChecklist, SetupReadinessCard,
              TopCustomers, TrackingSnippet
layout/     → AppSidebar, InsightToasts, LiveStatus, TenantSwitcher, ThemeToggle
detail/     → DetailController, DetailDrawer, DetailSkeleton, DetailableElement,
              Sparkline, builders.ts, types.ts, useDetailData.ts
integrations/ → IntegrationCard, IntegrationWizard
handbook/   → HandbookConnectors, HandbookSection, HandbookToc
ui/         → повний набір shadcn/ui компонентів
```

### Існуюча схема БД (НЕ редагуй міграції — лише нові файли):

```
CORE:
  tenants(id,slug,name,status,owner_user_id)
  tenant_memberships(tenant_id,user_id,role)
  user_roles(user_id,role→'super_admin')
  tenant_configs(tenant_id,brand_name,ui jsonb,features jsonb,bot jsonb,seo jsonb)
  plans, tenant_subscriptions, tenant_balances, balance_ledger, plan_change_log

COMMERCE:
  products(id,tenant_id,sku,name,description,price_cents,currency,
           image_url,stock,is_active,metadata)
  orders(id,tenant_id,customer_email,customer_name,status→enum,
         total_cents,currency,metadata)
  order_items(id,order_id,product_id,quantity,unit_price_cents,
              product_name,metadata)
  events(id,tenant_id,type→enum,session_id,product_id,order_id,payload)
  promotions(id,tenant_id,code,name,promo_type,value,applies_to_product_ids,
             starts_at,ends_at,usage_limit,times_used,revenue_cents,
             cost_cents,is_active,fatigue_score)
  content_pages(id,tenant_id,slug,title,content_type,body_md,
                seo_title,seo_description,is_published)
  social_proof_events(id,tenant_id,event_type,product_id,
                      display_text,metadata,is_active,expires_at)
  product_affinity(tenant_id,product_a_id,product_b_id,co_purchase_count)
  product_bundles(tenant_id,product_ids,bundle_price_cents,metadata)
  product_costs(id,tenant_id,product_id,cost_cents,...)
  search_queries(tenant_id,query,results_count,session_id)

CRM:
  customers(id,tenant_id,email,name,user_id,telegram_chat_id,
            lifecycle_stage,total_orders,total_spent_cents,avg_order_cents,
            first_order_at,last_order_at,predicted_next_order_at,
            avg_cycle_days,consent_marketing,metadata)
  customer_segments(id,tenant_id,name,rules,member_count,metadata)
  customer_ltv_scores(tenant_id,customer_email,predicted_ltv_cents,confidence)
  customer_cohorts(id,tenant_id,cohort_key,size,metadata)

AI/AGENTS:
  acos_agent_runs(id,tenant_id,agent_id,status,started_at,finished_at,
                  insights_count,actions_count,metadata)
  ai_insights(id,tenant_id,insight_type,affected_layer,title,description,
              expected_impact,confidence,risk_level,metrics,dedup_key,
              status,created_at)
  ai_actions(id,tenant_id,insight_id,action_type,status,payload,result)
  ai_memory(id,tenant_id,memory_key,value,confidence,ttl,updated_at)
  agent_health(tenant_id,agent_id,last_run_at,success_rate,avg_duration_ms)
  agent_conflicts(id,tenant_id,agent_a,agent_b,conflict_type,resolved)
  ab_tests(id,tenant_id,name,variants,status,results)
  price_elasticity(tenant_id,product_id,elasticity_score,metadata)
  pricing_decisions(tenant_id,product_id,old_price,new_price,reason,agent)
  decision_policies(tenant_id,policy_type,rules,is_active)
  bootstrap_facts(tenant_id,fact_kind,fact_key,value,confidence,evidence)

MESSAGING:
  outbound_messages(id,tenant_id,customer_id,channel,trigger_kind,
                    template_key,body,status,actual_revenue_cents,converted_at)
  conversations(id,tenant_id,customer_id,channel,thread_id,metadata)
  telegram_chat_routing(tenant_id,chat_id,route_type,context)
  telegram_bot_state(tenant_id,last_update_id,metadata)
  owner_telegram_outbox(id,tenant_id,message,status,sent_at)
  owner_notifications(id,tenant_id,type,payload,read_at)
  daily_digests(id,tenant_id,digest_date,payload,sent_at)
  cart_recovery_attempts(tenant_id,session_id,stage,metadata)

INTEGRATIONS:
  tenant_integrations(id,tenant_id,provider,status,config jsonb,metadata)
  import_jobs(id,tenant_id,source_provider,source_kind,entity_kind,
              status,rows_total,rows_imported,metadata)
  import_field_mappings(tenant_id,source_provider,entity_kind,mappings jsonb)
  dntrade_sync_errors(tenant_id,error_type,payload)
  integration_rate_limits(tenant_id,provider,window_start,request_count)
  anon_event_rate_limit(ip,window_start,count)
  inventory_forecasts(tenant_id,product_id,forecast_days,predicted_stock)

BILLING (existing):
  ugc_items(id,tenant_id,product_id,source,body,rating,author,metadata)
  content_performance(tenant_id,page_slug,views,conversions,metadata)
  channel_attribution(tenant_id,order_id,channel,metadata)
  order_fraud_signals(order_id,tenant_id,signal_type,score,metadata)
```

---

## 🔑 КЛЮЧОВІ УТИЛІТИ — ЗАВЖДИ ВИКОРИСТОВУЙ, НІКОЛИ НЕ ДУБЛЮЙ

### 1. Agent Runtime (src/lib/acos/agentRuntime.ts)

```typescript
// Функції для агентів:
import {
  authorizeAgentRequest, // перевіряє bearer token
  startAgentRun, // → AgentRunHandle
  finishAgentRun, // success
  failAgentRun, // failure
  insertInsightsDedup, // вставляє ai_insights без дублів
  jsonOk, // Response з 200
  jsonError, // Response з помилкою
  type AgentInsightInput, // тип для insights
  type AuthContext, // { kind: 'cron' } | { kind: 'user', userId }
} from "@/lib/acos/agentRuntime";
```

### 2. Grошові функції (src/lib/money.ts)

```typescript
import { formatMoney, formatMoneyCompact } from "@/lib/money";
// formatMoney(125000) → "1 250 ₴"
// formatMoneyCompact(1250000) → "12.5K ₴"
// ЗАВЖДИ зберігай в cents (integer), ніколи float
```

### 3. i18n (src/lib/i18n.ts)

```typescript
// В компонентах:
import { useT } from "@/lib/i18n";
const { t } = useT();
return <h1>{t("products.title")}</h1>;

// В route head():
import { tStatic } from "@/lib/i18n";
head: () => ({ meta: [{ title: tStatic("products.pageTitle") }] })

// ВАЖЛИВО: при додаванні нового ключа — додай в ОБОХ мовах (ua + en)
// в src/lib/i18n.ts в об'єкт dict.ua і dict.en
```

### 4. Supabase клієнти

```typescript
// CLIENT-SIDE (браузер, компоненти):
import { supabase } from "@/integrations/supabase/client";

// SERVER-SIDE ONLY (hooks/, server functions):
import { supabaseAdmin } from "@/integrations/supabase/client.server";
// ⚠️ НІКОЛИ не імпортуй supabaseAdmin в компоненти або client routes
```

### 5. Auth hooks

```typescript
import { useAuth } from "@/hooks/useAuth";
const { user, loading, isSuperAdmin, signOut } = useAuth();

import { useTenantContext } from "@/hooks/useTenantContext";
const { current, tenants } = useTenantContext();
// current.id, current.name, current.slug, current.tenant_name
```

### 6. Cart (src/lib/cart.ts)

```typescript
import { loadCart, saveCart, clearCart, type Cart } from "@/lib/cart";
// Cart = Record<string, { quantity: number; name: string; price_cents: number }>
```

---

## 📐 ОБОВ'ЯЗКОВІ ПАТТЕРНИ — КОПІЮЙ, НЕ ВИГАДУЙ

### Патерн 1: Server Function (Hook / Agent)

```typescript
// src/routes/hooks/agents.my-agent.ts
/**
 * ACOS Agent: My Agent
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

const AGENT_ID = "my_agent"; // snake_case, унікальний

export const Route = createFileRoute("/hooks/agents/my-agent")({
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
          // --- Логіка агента ---
          const { data, error } = await supabaseAdmin
            .from("some_table")
            .select("*")
            .eq("tenant_id", tenantId); // ← ЗАВЖДИ tenant_id фільтр
          if (error) throw error;

          const insights: AgentInsightInput[] = [];
          // ... бізнес логіка ...

          const inserted = await insertInsightsDedup(insights);
          return finishAgentRun(handle, { inserted, processed: data?.length ?? 0 });
        } catch (err) {
          return failAgentRun(handle, err);
        }
      },
    },
  },
});
```

### Патерн 2: React Component з TanStack Query

```typescript
// src/components/owner/MyComponent.tsx
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/money";
import { useT } from "@/lib/i18n";

type Props = { tenantId: string };

type MyRow = { id: string; name: string; value_cents: number };

export function MyComponent({ tenantId }: Props) {
  const { t } = useT();

  const { data, isLoading, error } = useQuery({
    queryKey: ["my-component", tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("some_table")
        .select("id, name, value_cents")
        .eq("tenant_id", tenantId)  // ← ЗАВЖДИ
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as MyRow[];
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    // toast показуй тільки при мутаціях, не при read queries
    return <p className="text-sm text-destructive">{t("common.loadError")}</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("myComponent.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {(data ?? []).map((row) => (
          <div key={row.id} className="flex justify-between py-2">
            <span className="text-sm text-foreground">{row.name}</span>
            <span className="text-sm font-medium">{formatMoney(row.value_cents)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

### Патерн 3: Authenticated Route

```typescript
// src/routes/_authenticated/brand.mypage.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useT } from "@/lib/i18n";
import { MyComponent } from "@/components/owner/MyComponent";

export const Route = createFileRoute("/_authenticated/brand/mypage")({
  component: MyPage,
});

function MyPage() {
  const { current } = useTenantContext();
  const { t } = useT();

  if (!current) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t("mypage.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("mypage.subtitle")}</p>
      </div>
      <MyComponent tenantId={current.id} />
    </div>
  );
}
```

### Патерн 4: Supabase Migration

```sql
-- supabase/migrations/[timestamp]_description.sql
-- ЗАВЖДИ використовуй ці функції для RLS:
--   public.is_super_admin()
--   public.is_tenant_member(tenant_id)
--   public.is_tenant_admin(tenant_id)  -- якщо існує, інакше is_tenant_member

-- Структура нової таблиці:
CREATE TABLE public.my_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- ... поля ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_my_table_tenant ON public.my_table(tenant_id);
CREATE TRIGGER trg_my_table_updated_at
  BEFORE UPDATE ON public.my_table
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS (обов'язково):
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "my_table_member_read" ON public.my_table
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "my_table_admin_insert" ON public.my_table
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "my_table_admin_update" ON public.my_table
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "my_table_admin_delete" ON public.my_table
  FOR DELETE TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- Для анонімного read (storefront):
CREATE POLICY "my_table_anon_read" ON public.my_table
  FOR SELECT TO anon USING (is_active = true);
```

### Патерн 5: Додати агента в run-all

```typescript
// В src/routes/hooks/agents.run-all.ts є масив AGENTS:
const AGENTS = [
  "onboarding",
  "churn-risk",
  // ... існуючі ...
  // Додаєш в кінці:
  "email-abandoned-cart",
  "email-winback",
];
// Також додай в agents.cron-all.ts якщо потрібен окремий cron schedule
```

---

## 🚨 СПИСОК ВІДСУТНЬОГО (АУДИТ ПІДТВЕРДЖЕНИЙ)

### ❌ Немає взагалі:

1. **brand.products.tsx** — мерчант не може керувати товарами через UI
2. **brand.products.$productId.tsx** — редагування товару з tabs
3. **brand.orders.tsx** — мерчант не бачить свої замовлення (є лише в super-admin!)
4. **brand.catalog.tsx** — немає колекцій
5. **brand.promotions.tsx** — промокоди є в БД, UI немає
6. **brand.email.tsx** — email-маркетинг
7. **s.$slug.\_layout.tsx** — storefront layout
8. **s.$slug.products.$productId.tsx** — сторінка товару
9. **s.$slug.collections.$handle.tsx** — сторінка колекції
10. **s.$slug.search.tsx** — пошук
11. **s.$slug.checkout.tsx** — checkout як окрема сторінка
12. **Email інфраструктура** — жодного email файлу в проекті
13. **Nova Poshta / Justin / Meest** — shipping API integrations
14. **LiqPay / WayForPay / Monobank** — платіжні шлюзи
15. **product_variants таблиця** — немає варіантів товарів
16. **product_images таблиця** — немає множинних фото
17. **collections таблиця** — немає колекцій
18. **loyalty_accounts таблиця** — loyalty agentExists, DB немає
19. **email_sends таблиця** — немає логу email-розсилок
20. **Supabase Storage bucket** 'product-images' — не налаштований

### ⚠️ Існує частково (потребує розширення):

- `ProductForm.tsx` — базова форма без варіантів і фото
- `TenantConfigForm.tsx` — немає полів для shipping і нових платежів
- `s.$slug.tsx` — 766 рядків, все в одному файлі, потребує розбивки
- `agents.loyalty-tiers.ts` — агент є, але таблиці loyalty_accounts/loyalty_transactions немає

---

## 🏗️ БЛОКИ РЕАЛІЗАЦІЇ

---

### БЛОК 1 — DATABASE FOUNDATION

**(Перший sprint — все інше залежить від цього)**

#### Migration 1: `[timestamp]_product_catalog_v2.sql`

```sql
-- ================================================================
-- PRODUCT CATALOG V2
-- ================================================================

-- 1. Варіанти товарів
CREATE TABLE public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT,
  option_1_name TEXT,   -- "Вага", "Розмір", "Колір"
  option_1_value TEXT,  -- "100 г", "XL", "Чорний"
  option_2_name TEXT,
  option_2_value TEXT,
  option_3_name TEXT,
  option_3_value TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  compare_at_price_cents INTEGER CHECK (compare_at_price_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, sku)
);
CREATE INDEX idx_variants_product ON public.product_variants(product_id);
CREATE INDEX idx_variants_tenant ON public.product_variants(tenant_id, is_active);
CREATE TRIGGER trg_variants_updated_at BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Множинні фото
CREATE TABLE public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_images_product ON public.product_images(product_id, position);
CREATE UNIQUE INDEX idx_images_primary ON public.product_images(product_id)
  WHERE is_primary = true;  -- лише одне головне фото

-- 3. Колекції
CREATE TABLE public.collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  is_smart BOOLEAN NOT NULL DEFAULT false,
  rules JSONB DEFAULT '[]',  -- [{ field, op, value }]
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, handle)
);
CREATE INDEX idx_collections_tenant ON public.collections(tenant_id, is_active);
CREATE TRIGGER trg_collections_updated_at BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Зв'язок колекцій з товарами
CREATE TABLE public.collection_products (
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX idx_cp_collection ON public.collection_products(collection_id, position);

-- 5. ALTER існуючих таблиць (безпечно з IF NOT EXISTS)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS compare_at_price_cents INTEGER CHECK (compare_at_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS url_handle TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER,
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS has_variants BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_address JSONB,
  ADD COLUMN IF NOT EXISTS shipping_method TEXT,
  ADD COLUMN IF NOT EXISTS shipping_cost_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS payment_ref TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS discount_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER DEFAULT 0;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

-- 6. RLS для нових таблиць
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_products ENABLE ROW LEVEL SECURITY;

-- product_variants
CREATE POLICY "pv_member_read" ON public.product_variants FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "pv_member_write" ON public.product_variants FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "pv_anon_read" ON public.product_variants FOR SELECT TO anon
  USING (is_active = true);

-- product_images
CREATE POLICY "pi_member_read" ON public.product_images FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "pi_member_write" ON public.product_images FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "pi_anon_read" ON public.product_images FOR SELECT TO anon USING (true);

-- collections
CREATE POLICY "col_member_read" ON public.collections FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "col_member_write" ON public.collections FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "col_anon_read" ON public.collections FOR SELECT TO anon
  USING (is_active = true);

-- collection_products
CREATE POLICY "cp_member_read" ON public.collection_products FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "cp_member_write" ON public.collection_products FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "cp_anon_read" ON public.collection_products FOR SELECT TO anon USING (true);

-- 7. RPCs для storefront (Security Definer = читає без RLS)
CREATE OR REPLACE FUNCTION public.get_storefront_products_v2(_slug TEXT)
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, price_cents INTEGER,
  compare_at_price_cents INTEGER, currency TEXT, image_url TEXT,
  stock INTEGER, has_variants BOOLEAN, tags TEXT[], url_handle TEXT
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.description, p.price_cents, p.compare_at_price_cents,
         p.currency, p.image_url, p.stock, p.has_variants, p.tags, p.url_handle
  FROM public.products p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE t.slug = _slug AND t.status = 'active' AND p.is_active = true
  ORDER BY p.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_storefront_product(_slug TEXT, _product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'product', row_to_json(p),
    'images', COALESCE((
      SELECT jsonb_agg(row_to_json(i) ORDER BY i.position)
      FROM product_images i WHERE i.product_id = p.id
    ), '[]'::jsonb),
    'variants', COALESCE((
      SELECT jsonb_agg(row_to_json(v) ORDER BY v.option_1_value)
      FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM products p
  JOIN tenants t ON t.id = p.tenant_id
  WHERE t.slug = _slug AND p.id = _product_id AND p.is_active = true;

  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_discount_code(
  _slug TEXT, _code TEXT, _order_total_cents INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tid UUID;
  v_p RECORD;
  v_disc INTEGER;
BEGIN
  SELECT t.id INTO v_tid FROM tenants t WHERE t.slug = _slug AND t.status = 'active';
  IF v_tid IS NULL THEN RETURN '{"valid":false,"error":"store_not_found"}'::JSONB; END IF;

  SELECT * INTO v_p FROM promotions
  WHERE tenant_id = v_tid
    AND UPPER(code) = UPPER(_code)
    AND is_active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
    AND (usage_limit IS NULL OR times_used < usage_limit);

  IF v_p IS NULL THEN RETURN '{"valid":false,"error":"invalid_or_expired"}'::JSONB; END IF;

  IF v_p.promo_type = 'percent_off' THEN
    v_disc := (_order_total_cents * v_p.value::numeric / 100)::INTEGER;
  ELSIF v_p.promo_type = 'fixed_off' THEN
    v_disc := LEAST((v_p.value * 100)::INTEGER, _order_total_cents);
  ELSE v_disc := 0; END IF;

  RETURN jsonb_build_object('valid', true, 'promo_id', v_p.id,
    'name', v_p.name, 'type', v_p.promo_type, 'discount_cents', v_disc);
END; $$;
```

#### Migration 2: `[timestamp]_email_engine.sql`

```sql
-- EMAIL ENGINE
CREATE TABLE public.email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  template TEXT NOT NULL,  -- 'order-confirmed' | 'abandoned-cart' | 'winback' | etc.
  subject TEXT,
  resend_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','delivered','opened','clicked','bounced','failed')),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  campaign_id UUID,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_sends_tenant ON public.email_sends(tenant_id, created_at DESC);
CREATE INDEX idx_email_sends_order ON public.email_sends(order_id) WHERE order_id IS NOT NULL;

CREATE TABLE public.email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  segment TEXT DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipients_count INTEGER DEFAULT 0,
  opens_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "es_member_read" ON public.email_sends FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "ec_member_read" ON public.email_campaigns FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "ec_member_write" ON public.email_campaigns FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));
```

#### Migration 3: `[timestamp]_loyalty_program.sql`

```sql
-- LOYALTY PROGRAM
CREATE TABLE public.loyalty_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Програма лояльності',
  points_per_100_uah INTEGER NOT NULL DEFAULT 1,
  uah_per_point NUMERIC NOT NULL DEFAULT 1.0,
  min_redeem_points INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT false,
  tiers JSONB NOT NULL DEFAULT '[
    {"name":"Бронза","slug":"bronze","min_points":0,"discount_pct":0},
    {"name":"Срібло","slug":"silver","min_points":500,"discount_pct":5},
    {"name":"Золото","slug":"gold","min_points":2000,"discount_pct":10},
    {"name":"Платина","slug":"platinum","min_points":5000,"discount_pct":15}
  ]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.loyalty_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  balance_points INTEGER NOT NULL DEFAULT 0 CHECK (balance_points >= 0),
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  tier_slug TEXT NOT NULL DEFAULT 'bronze',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, customer_email)
);
CREATE INDEX idx_loyalty_tenant ON public.loyalty_accounts(tenant_id);
CREATE TRIGGER trg_loyalty_updated_at BEFORE UPDATE ON public.loyalty_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.loyalty_accounts(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('earn','redeem','expire','bonus','refund')),
  points INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lt_account ON public.loyalty_transactions(account_id, created_at DESC);

-- Сповіщення про повернення товару
CREATE TABLE public.restock_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, product_id, email)
);

-- RLS
ALTER TABLE public.loyalty_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restock_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lp_member_read" ON public.loyalty_programs FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "lp_member_write" ON public.loyalty_programs FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "la_member_read" ON public.loyalty_accounts FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
-- Anon read для storefront (показ балансу)
CREATE POLICY "la_anon_read" ON public.loyalty_accounts FOR SELECT TO anon USING (true);
CREATE POLICY "lt_member_read" ON public.loyalty_transactions FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "rn_member_read" ON public.restock_notifications FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "rn_anon_insert" ON public.restock_notifications FOR INSERT TO anon
  WITH CHECK (true);  -- покупець підписується без авторизації
```

---

### БЛОК 2 — STOREFRONT EXPANSION

#### 2.1 Storefront Layout: `src/routes/s.$slug._layout.tsx`

```
Компонент-обгортка для всіх s.$slug.* routes:

State (через Context або Route context):
  - cart: Cart (loadCart з localStorage)
  - cartCount: number
  - tenantId: string
  - config: ConfigRow (brand colors, brand name)
  - payments: PaymentsConfig

UI:
  Header:
    - Logo бренду (logo_url з config або назва)
    - Search input → navigate до /s/$slug/search?q=...
    - Cart icon з Badge (cartCount)
    - Cart як Sheet (переноси з s.$slug.tsx)

  CSS vars: inject brand colors з config.ui (як в s.$slug.tsx themeStyle)

  Footer:
    - brand name
    - "Powered by MARQ" (малий текст)
    - Посилання: track.slug.js для tracking

<Outlet /> — рендерить вкладені routes
```

#### 2.2 Storefront Homepage: `src/routes/s.$slug.index.tsx`

```
Завантаження: get_storefront_products_v2(_slug) + get_storefront_collections(_slug) [нова RPC]
track('content_viewed', {})

UI:
  Hero:
    - Фото (config.ui.hero_image якщо є) або gradient з brand colors
    - Назва бренду, tagline з config.ui.tagline
    - CTA кнопка "Переглянути товари"

  Колекції (якщо є):
    - Grid 2-4 колонки, image + назва
    - Кожна → navigate /s/$slug/collections/$handle

  Товари:
    - Grid: фото | назва | ціна | залишок
    - При кліку → navigate /s/$slug/products/$productId
    - "Додати в кошик" без переходу (inline)

  Social proof:
    - 5 останніх social_proof_events типу 'review'
    - Автоскрол carousel
```

#### 2.3 Product Page: `src/routes/s.$slug.products.$productId.tsx`

```
Завантаження: get_storefront_product(_slug, productId)
track('product_viewed', { product_id: productId })

UI:
  Left: Image gallery
    - Головне фото (is_primary або перше)
    - Thumbnails strip
    - Swipe на mobile (CSS scroll-snap)
    - Якщо немає product_images → image_url з products

  Right: Product details
    - Назва, breadcrumb
    - Ціна + compare_at (закреслена якщо більша)
    - Badge "ЗНИЖКА -X%" якщо compare_at > price
    - Variant selector (якщо has_variants = true):
        * Групуй по option_1_name
        * Кнопки-пілюлі для кожного варіанту
        * Вибрати → оновлення ціни/фото/стоку
        * Якщо stock = 0 → disabled + форма "Повідомити"
          (INSERT в restock_notifications)
    - Кількість: minus/plus input
    - Кнопка "Додати в кошик"
      → track('add_to_cart', { product_id })
      → оновити cart в localStorage

  Секція "Часто купують разом":
    - product_affinity WHERE product_a_id = productId
    - Показуй максимум 3 супутні товари

  Відгуки:
    - social_proof_events WHERE product_id = productId AND event_type='review'
    - Рейтинг зірками (metadata.rating), автор, текст

  Related products:
    - Перші 4 товари з тієї ж колекції або просто останні 4
```

#### 2.4 Search: `src/routes/s.$slug.search.tsx`

```
URL: /s/$slug/search?q=натурал

Завантаження: get_storefront_products_v2(_slug) стaleTime=5min

Filter (client-side):
  query = useSearch({ from: '/s/$slug/search' }).q
  results = products.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.description?.toLowerCase().includes(query.toLowerCase()) ||
    p.tags?.some(t => t.includes(query.toLowerCase()))
  )

При зміні query (debounce 500ms):
  INSERT INTO search_queries { tenant_id, query, results_count, session_id }
  (через ingest endpoint або server function)

UI:
  - Input (pre-filled з query param)
  - Кількість результатів
  - Якщо 0 → "Нічого не знайдено. Популярні товари:" + 4 products
  - Grid результатів (той самий ProductCard)
```

#### 2.5 Checkout: `src/routes/s.$slug.checkout.tsx`

```
One-page accordion layout. Секції розгортаються sequential.

Секція 1 — Кошик:
  - Summary позицій з можливістю зміни кількості
  - Сума

Секція 2 — Контакти:
  - Ім'я, email, телефон
  - Validation: email format, phone format

Секція 3 — Доставка:
  - RadioGroup: Нова Пошта | Justin | Meest | Самовивіз
  - При виборі НП:
    * Combobox міста → GET /hooks/shipping/np-cities?q=...
    * Combobox відділення → GET /hooks/shipping/np-warehouses?cityRef=...
    * Розрахункова вартість (flat rate з config або API)
  - Free shipping threshold (якщо в config.features.shipping.free_shipping_from_cents)
  - Progress bar "До безкоштовної доставки ще X ₴"

Секція 4 — Промокод:
  - Input + кнопка "Застосувати"
  - RPC validate_discount_code → показати знижку або помилку

Секція 5 — Оплата:
  - RadioGroup методів оплати (лише enabled в tenant_config)
  - Stripe: Stripe Elements iframe
  - LiqPay: форма POST на liqpay.ua
  - WayForPay: форма POST на wayforpay.com
  - Monobank: redirect на pageUrl
  - Ручна: інструкції з config.features.payments.manual_instructions

Order summary сайдбар (desktop) або sticky bottom (mobile):
  - Список позицій
  - Subtotal, знижка, доставка, TOTAL
  - Кнопка "Оформити замовлення"

При успішному замовленні:
  - INSERT order через RPC place_storefront_order_v3
  - track('purchase_completed', { order_id, total_cents })
  - Redirect → /s/$slug/orders/$orderId (вже існує)
  - Email order-confirmed надсилається автоматично
```

---

### БЛОК 3 — BRAND OWNER ROUTES

#### 3.1 `src/routes/_authenticated/brand.products.tsx`

```
Таблиця товарів тенанта:
  Колонки: Фото | Назва | SKU | Ціна | Залишок | Статус | Дії

Filter:
  - Tabs: Всі / Активні / Не в наявності (stock=0)
  - Search input (client-side по name+sku)

Дії:
  - "Додати товар" → navigate /brand/products/new
  - "Синхронізувати з DN Trade" → POST /hooks/integrations/dntrade-sync (вже існує)
  - Row Edit → navigate /brand/products/$productId
  - Row Delete → AlertDialog → DELETE product (тільки якщо немає orders)

Data:
  supabase.from('products').select('id,name,sku,price_cents,stock,is_active,image_url')
    .eq('tenant_id', tenantId)

Sorting: по created_at DESC за замовчуванням

Pagination: 50 per page (limit/offset)
```

#### 3.2 `src/routes/_authenticated/brand.products.$productId.tsx`

```
Параметр: productId ('new' для нового товару)

Tabs:
  Tab 1 "Основне":
    - name (required)
    - sku
    - description (Textarea)
    - price_cents (input в грн, конвертуй × 100)
    - compare_at_price_cents
    - currency (select: UAH/USD/EUR)
    - stock (number)
    - weight_grams
    - url_handle (auto-generate з name, editable)
    - tags (comma-separated input → string[])
    - is_active (Switch)

  Tab 2 "Фотографії":
    - Завантаж з product_images WHERE product_id
    - Upload: input type=file → uploadProductImage() → INSERT product_images
    - Grid фото з drag-and-drop reorder (position UPDATE)
    - Delete кнопка (DELETE + supabase.storage.remove)
    - "Зробити головним" → UPDATE is_primary

  Tab 3 "Варіанти":
    - Switch "Є варіанти" → UPDATE products SET has_variants
    - Якщо увімкнено:
      * Options builder: Назва опції + значення (comma-separated)
        e.g. "Вага: 100 г, 250 г, 500 г"
      * Кнопка "Генерувати варіанти" → створює product_variants для кожної комбінації
      * Таблиця варіантів: SKU | option values | price | stock | active | delete
      * Inline edit ціни і стоку прямо в таблиці

  Tab 4 "SEO":
    - seo_title (auto-fill з name)
    - seo_description
    - url_handle (editable, показуй preview URL)
    - Google snippet preview (div styled like Google result)

  Tab 5 "Аналітика" (read-only):
    - views за 30д: COUNT events WHERE type='product_viewed' AND product_id
    - add_to_cart за 30д
    - purchases за 30д
    - Conversion funnel: mini bar chart

Save: useMutation → UPSERT products + toast success
```

#### 3.3 `src/routes/_authenticated/brand.orders.tsx`

```
Таблиця замовлень тенанта (ЗАРАЗ МЕРЧАНТ ЇХ НЕ БАЧИТЬ — критична проблема!):

Columns: # | Клієнт | Сума | Статус | Метод оплати | Дата

Filters:
  - Status tabs: Всі / Нові / Оплачені / Відправлені / Скасовані
  - Date range picker
  - Search по email клієнта

On row click → Sheet/Drawer:
  - Деталі замовлення: customer info, shipping address, items
  - Order items таблиця
  - Status timeline (з metadata.status_history)
  - Дії:
    "Підтвердити оплату" (pending→paid, записати paid_at)
    "Відправити" → Dialog: ввести tracking_number, tracking_url (fulfilled)
    "Скасувати" → AlertDialog (→cancelled)
    "Повернути" → (→refunded)
  - При зміні статусу: записати в metadata.status_history[], оновити fulfilled_at/paid_at

Export:
  - Кнопка "Export CSV" → papaparse → download (вже є papaparse в deps)

Data:
  supabase.from('orders')
    .select('id,customer_email,customer_name,total_cents,status,payment_method,
             created_at,paid_at,fulfilled_at,tracking_number,shipping_address,metadata')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
```

#### 3.4 `src/routes/_authenticated/brand.promotions.tsx`

```
Таблиця промокодів:
  Columns: Код | Назва | Тип | Значення | Використань | Активний | Термін | Дії

"Новий промокод" → Sheet з формою:
  - code (або Auto-generate: кнопка → crypto.randomUUID().slice(0,8).toUpperCase())
  - name
  - promo_type: select percent_off / fixed_off / free_shipping
  - value (% або грн)
  - usage_limit (optional)
  - starts_at, ends_at (DatePicker)
  - is_active (Switch)

"Bulk generate" → Dialog:
  - Кількість N
  - Prefix (e.g. "SALE-")
  - Generate → array of {code: prefix+random} → INSERT все → CSV download

Stats per code:
  - times_used / usage_limit
  - revenue_cents (скільки продажів принесло)
  - ROI: revenue_cents / (cost_cents || 1)

Data: supabase.from('promotions').select('*').eq('tenant_id', tenantId)
```

---

### БЛОК 4 — EMAIL ENGINE

#### 4.1 Infrastructure

**Встанови Resend:**

```bash
bun add resend @react-email/components @react-email/render
```

**`src/lib/email/resend.server.ts`:**

```typescript
import { Resend } from "resend";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function getTenantResend(tenantId: string) {
  const { data: cfg } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .single();

  const email = (cfg?.features as Record<string, unknown> | null)?.email as
    | { resend_api_key?: string; from_name?: string; from_email?: string }
    | undefined;

  if (!email?.resend_api_key) return null;

  return {
    client: new Resend(email.resend_api_key),
    from: `${email.from_name ?? "Магазин"} <${email.from_email ?? "noreply@marq.app"}>`,
  };
}

export async function sendTransactionalEmail(params: {
  tenantId: string;
  to: string;
  template: string;
  subject: string;
  htmlContent: string;
  orderId?: string;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const resend = await getTenantResend(params.tenantId);
  if (!resend) return null; // email не налаштований — мовчки ігноруємо

  try {
    const { data, error } = await resend.client.emails.send({
      from: resend.from,
      to: params.to,
      subject: params.subject,
      html: params.htmlContent,
    });
    if (error) throw error;

    await supabaseAdmin.from("email_sends").insert({
      tenant_id: params.tenantId,
      to_email: params.to,
      template: params.template,
      subject: params.subject,
      resend_message_id: data?.id ?? null,
      order_id: params.orderId ?? null,
      status: "sent",
      metadata: params.metadata ?? {},
    });

    return data?.id ?? null;
  } catch (err) {
    console.error("Email send failed:", err);
    return null;
  }
}
```

**Templates (src/lib/email/templates/):**

Кожен template — React Email компонент. Наприклад `order-confirmed.tsx`:

```typescript
// src/lib/email/templates/order-confirmed.tsx
import { Html, Body, Container, Heading, Text, Section, Row, Column } from "@react-email/components";

interface Props {
  brandName: string;
  orderNumber: string; // перші 8 символів id
  customerName: string;
  items: { name: string; quantity: number; price_cents: number }[];
  totalCents: number;
  trackingUrl: string;
}

export function OrderConfirmedEmail({ brandName, orderNumber, customerName, items, totalCents, trackingUrl }: Props) {
  return (
    <Html>
      <Body style={{ fontFamily: "Arial, sans-serif", background: "#f4f4f5" }}>
        <Container style={{ maxWidth: 600, margin: "0 auto", background: "#fff", padding: 32 }}>
          <Heading style={{ fontSize: 24, marginBottom: 8 }}>
            Дякуємо за замовлення! 🎉
          </Heading>
          <Text>Привіт, {customerName}! Ваше замовлення #{orderNumber} підтверджено в {brandName}.</Text>
          {/* items table */}
          <Section>
            {items.map((item, i) => (
              <Row key={i}>
                <Column>{item.name} × {item.quantity}</Column>
                <Column style={{ textAlign: "right" }}>
                  {(item.price_cents / 100).toLocaleString("uk-UA")} ₴
                </Column>
              </Row>
            ))}
          </Section>
          <Text style={{ fontWeight: "bold" }}>
            Всього: {(totalCents / 100).toLocaleString("uk-UA")} ₴
          </Text>
          <Text>
            <a href={trackingUrl}>Відстежити замовлення →</a>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

Аналогічно створи: `abandoned-cart.tsx`, `winback.tsx`, `order-shipped.tsx`, `restock.tsx`

#### 4.2 Email Server Functions

**`src/routes/hooks/email.order-confirmed.ts`** — POST { tenant_id, order_id }

```
1. Завантаж order + order_items + tenant_config
2. Render OrderConfirmedEmail
3. sendTransactionalEmail(...)
4. Return 200
```

**`src/routes/hooks/email.resend-webhook.ts`** — POST (Resend webhook)

```
1. Перевір підпис (Resend-Signature header)
2. Визнач тип: email.opened / email.clicked / email.bounced / email.delivered
3. UPDATE email_sends SET status, opened_at або clicked_at
4. Return 200
```

#### 4.3 `src/routes/_authenticated/brand.email.tsx`

```
Tabs: Кампанії | Автоматизації | Налаштування

Tab Кампанії:
  - Список email_campaigns
  - "Нова кампанія" → Wizard:
    Step 1: Назва і тема
    Step 2: Шаблон (dropdown) + Preview
    Step 3: Сегмент (all / active / at_risk / vip)
    Step 4: Розклад (зараз / дата)
    Confirm → INSERT email_campaigns + trigger sending

Tab Автоматизації:
  - Toggle cards:
    "Кинутий кошик" (agents.email-abandoned-cart)
    "Повернення клієнтів" (agents.email-winback)
    "Після доставки" (agents.email-post-purchase)
  - Кожен toggle → UPDATE tenant_configs SET features.email_automations.X

Tab Налаштування:
  - Resend API Key (password input)
  - From Name, From Email
  - Test → надіслати тестовий лист
  - Save → UPDATE tenant_configs SET features.email = {...}
```

---

### БЛОК 5 — SHIPPING INTEGRATION

#### 5.1 `src/routes/hooks/shipping.np-cities.ts` — GET ?q=Київ

```typescript
// Proxy до Nova Poshta API
// Читає np_api_key з tenant_configs.features.shipping.nova_poshta_api_key
// НЕ виставляє ключ клієнту
// Кешує: in-memory Map<string, data> з TTL 24h (Cloudflare Worker — глобальний Map)
// Повертає: [{ Ref, Description, AreaDescription }]
```

#### 5.2 `src/routes/hooks/shipping.np-warehouses.ts` — GET ?cityRef=xxx

```typescript
// Аналогічно: Nova Poshta getWarehouses
// Повертає: [{ Ref, Number, Description, TypeOfWarehouse }]
```

#### 5.3 `src/components/checkout/ShippingSelector.tsx`

```typescript
// Props: tenantId, slug, onSelect: (method: ShippingSelection) => void
// type ShippingSelection = {
//   provider: 'nova_poshta' | 'justin' | 'meest' | 'pickup';
//   city?: string; city_ref?: string;
//   warehouse?: string; warehouse_ref?: string;
//   address?: string;
//   cost_cents: number;
// }
```

---

### БЛОК 6 — ПЛАТІЖНІ ШЛЮЗИ

#### `src/routes/hooks/payments.liqpay.ts` — POST { tenant_id, order_id, amount_cents, return_url }

```typescript
// Server function:
// 1. Зчитує liqpay_public_key + liqpay_private_key з tenant_configs
// 2. Формує LiqPay data JSON: { version, public_key, action, amount, currency,
//    description, order_id, result_url, server_url }
// 3. data_string = base64(JSON.stringify(data))
// 4. signature = base64(SHA1(private_key + data_string + private_key))
// 5. Повертає { data: data_string, signature }
// Клієнт: <form action="https://www.liqpay.ua/api/3/checkout" method="POST">
//           <input name="data" value={data} />
//           <input name="signature" value={signature} />
//         </form>
```

#### `src/routes/hooks/payments.liqpay-callback.ts` — POST (LiqPay webhook)

```typescript
// 1. Перевір підпис: base64(SHA1(private_key + req.data + private_key))
// 2. Decode data: JSON.parse(base64_decode(req.data))
// 3. Якщо status === 'success': UPDATE orders SET status='paid', payment_ref=data.liqpay_order_id
// 4. POST /hooks/email/order-confirmed
// 5. POST /hooks/telegram/notify-owner (вже існує)
// Return 200 (LiqPay чекає саме 200)
```

#### `src/routes/hooks/payments.wayforpay.ts` — POST { tenant_id, order_id, items, amount }

```typescript
// Генерує WayForPay підпис (HMAC-MD5)
// Signature string: merchant;domain;orderRef;orderDate;amount;currency;productName;productCount;productPrice
// Повертає: { merchantAccount, orderReference, orderDate, amount, currency,
//             productName[], productCount[], productPrice[], signature }
```

#### `src/routes/hooks/payments.monobank.ts` — POST { tenant_id, order_id, amount_cents, redirect_url }

```typescript
// POST https://api.monobank.ua/api/merchant/invoice/create
// Headers: X-Token: {monobank_token}
// Body: { amount, ccy: 980, redirectUrl, webHookUrl, reference: order_id }
// Повертає: { pageUrl } → клієнт редиректує
```

---

### БЛОК 7 — НОВІ ACOS АГЕНТИ

#### `src/routes/hooks/agents.email-abandoned-cart.ts`

```
AGENT_ID: "email_abandoned_cart"
Додай в AGENTS масив у agents.run-all.ts: "email-abandoned-cart"

Logic:
1. Знайди events WHERE type='checkout_started'
   AND created_at BETWEEN now()-23h AND now()-1h
   AND tenant_id = tenantId
2. Для кожного session_id: чи є purchase_completed з тим же session_id?
   Якщо так → skip
3. Є email в events.payload.email? Якщо ні → skip
4. Чи надсилали email_sends для цього session_id за 7 днів?
   Якщо так → skip (dedup)
5. Завантаж payload.cart_items (зберігай в events при checkout_started)
6. sendTransactionalEmail({ template: 'abandoned-cart', to: email, ... })
7. insertInsightsDedup (тип: 'abandoned_cart_email')
```

#### `src/routes/hooks/agents.email-winback.ts`

```
AGENT_ID: "email_winback"

Logic:
1. customers WHERE lifecycle_stage='at_risk'
   AND consent_marketing=true
   AND tenant_id=tenantId
2. Для кожного: email_sends за 14 днів? Skip якщо є
3. Генеруй промокод WINBACK-{random8}
4. INSERT promotions { code, promo_type:'percent_off', value:5,
   ends_at: now()+7days, usage_limit:1, applies_to_product_ids:[] }
5. sendTransactionalEmail({ template: 'winback', vars: { promo_code, discount_pct:5 } })
6. insertInsightsDedup (тип: 'email_winback')
```

#### `src/routes/hooks/agents.email-post-purchase.ts`

```
AGENT_ID: "email_post_purchase"

Logic:
1. orders WHERE status='fulfilled'
   AND fulfilled_at BETWEEN now()-8d AND now()-6d
   AND tenant_id=tenantId
2. Немає email_sends WHERE order_id=order.id AND template='order-delivered'?
3. sendTransactionalEmail({ template: 'order-delivered',
   vars: { storefront_url: /s/$slug } })
```

#### `src/routes/hooks/agents.restock-notifier.ts`

```
AGENT_ID: "restock_notifier"

Logic:
1. products WHERE is_active=true AND stock>0 AND metadata->>'was_out_of_stock'='true'
2. restock_notifications WHERE product_id IN (...) AND notified_at IS NULL
3. Для кожного: sendTransactionalEmail({ template: 'restock' })
4. UPDATE restock_notifications SET notified_at=now()
5. UPDATE products SET metadata = metadata - 'was_out_of_stock' (скинути флаг)
```

---

### БЛОК 8 — SIDEBAR + NAVIGATION UPDATE

#### `src/components/layout/AppSidebar.tsx`

Додай нову групу "Магазин" для owner (non-super-admin):

```typescript
// Після існуючих аналітичних посилань, перед "Налаштування":
{ label: t("sb.products"), to: "/brand/products", icon: Package },
{ label: t("sb.orders"), to: "/brand/orders", icon: ShoppingCart },
{ label: t("sb.catalog"), to: "/brand/catalog", icon: LayoutGrid },
{ label: t("sb.promotions"), to: "/brand/promotions", icon: Tag },
{ label: t("sb.email"), to: "/brand/email", icon: Mail },
```

Додай відповідні i18n ключі в `src/lib/i18n.ts`:

```typescript
// dict.ua:
"sb.products": "Товари",
"sb.orders": "Замовлення",
"sb.catalog": "Колекції",
"sb.promotions": "Промокоди",
"sb.email": "Email-маркетинг",
// dict.en:
"sb.products": "Products",
"sb.orders": "Orders",
"sb.catalog": "Collections",
"sb.promotions": "Promo codes",
"sb.email": "Email marketing",
```

---

### БЛОК 9 — SUPABASE STORAGE

**Migration: `[timestamp]_storage_setup.sql`**

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,  -- 5MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "product_images_public_read"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'product-images');

CREATE POLICY IF NOT EXISTS "product_images_auth_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY IF NOT EXISTS "product_images_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');
```

**`src/lib/storage.ts`:**

```typescript
import { supabase } from "@/integrations/supabase/client";

export async function uploadProductImage(
  tenantId: string,
  productId: string,
  file: File,
): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${tenantId}/${productId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, file, { upsert: false, contentType: file.type });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteProductImage(url: string): Promise<void> {
  // Extract path from URL
  const pathMatch = url.match(/product-images\/(.+)$/);
  if (!pathMatch) return;
  await supabase.storage.from("product-images").remove([pathMatch[1]]);
}
```

---

## 📋 ПОРЯДОК ВИКОНАННЯ (СТРОГО)

```
SPRINT 1 — DB FOUNDATION (виконай першим, все залежить від цього)
  □ migration: product_catalog_v2.sql
  □ migration: email_engine.sql
  □ migration: loyalty_program.sql
  □ migration: storage_setup.sql
  □ Запусти: supabase db push
  □ Запусти: supabase gen types typescript --local > src/integrations/supabase/types.ts
  □ Перевір: tsc --noEmit — 0 помилок

SPRINT 2 — STOREFRONT
  □ s.$slug._layout.tsx (cart context + header)
  □ Перейменуй s.$slug.tsx → s.$slug.index.tsx (або збережи як є і додай layout)
  □ s.$slug.products.$productId.tsx
  □ s.$slug.search.tsx
  □ s.$slug.checkout.tsx (витягни з s.$slug.tsx)
  □ src/lib/storage.ts
  □ ShippingSelector.tsx компонент
  □ hooks/shipping.np-cities.ts
  □ hooks/shipping.np-warehouses.ts
  □ Перевір: tsc --noEmit — 0 помилок

SPRINT 3 — BRAND ADMIN ROUTES
  □ brand.products.tsx
  □ brand.products.$productId.tsx
  □ brand.orders.tsx
  □ brand.catalog.tsx
  □ brand.promotions.tsx
  □ AppSidebar.tsx — нові посилання
  □ i18n.ts — нові ключі (ua + en обидва)
  □ Перевір: tsc --noEmit — 0 помилок

SPRINT 4 — EMAIL ENGINE
  □ bun add resend @react-email/components @react-email/render
  □ src/lib/email/resend.server.ts
  □ src/lib/email/templates/order-confirmed.tsx
  □ src/lib/email/templates/abandoned-cart.tsx
  □ src/lib/email/templates/winback.tsx
  □ src/lib/email/templates/order-shipped.tsx
  □ src/lib/email/templates/restock.tsx
  □ hooks/email.order-confirmed.ts
  □ hooks/email.resend-webhook.ts
  □ brand.email.tsx
  □ Перевір: tsc --noEmit — 0 помилок

SPRINT 5 — PAYMENTS
  □ hooks/payments.liqpay.ts
  □ hooks/payments.liqpay-callback.ts
  □ hooks/payments.wayforpay.ts
  □ hooks/payments.monobank.ts
  □ TenantConfigForm.tsx — додай поля payments (LiqPay, WayForPay, Monobank, shipping)
  □ Перевір: tsc --noEmit — 0 помилок

SPRINT 6 — NEW AGENTS
  □ agents.email-abandoned-cart.ts
  □ agents.email-winback.ts
  □ agents.email-post-purchase.ts
  □ agents.restock-notifier.ts
  □ agents.run-all.ts — додай нові в масив AGENTS
  □ Перевір: tsc --noEmit — 0 помилок
  □ Перевір: всі нові агенти з'являються в AcosAgentRuns dashboard
```

---

## ✅ SELF-VERIFICATION CHECKLIST (ОБОВ'ЯЗКОВО ДЛЯ КОЖНОГО ФАЙЛУ)

Перед здачею кожного файлу пройди цей список:

### TypeScript

- [ ] `tsc --noEmit` — нуль помилок
- [ ] Нуль `any` (окрім `unknown` при обробці JSON)
- [ ] Всі імпорти резолвяться (перевір шляхи через `@/`)
- [ ] Типи Supabase використані з `@/integrations/supabase/types`

### Database

- [ ] Кожен `.from()` запит має `.eq("tenant_id", tenantId)`
- [ ] `supabaseAdmin` — лише в `hooks/` і `*.server.ts` файлах
- [ ] `supabase` (anon) — лише в компонентах
- [ ] Нові міграції: чи є TRIGGER для updated_at?
- [ ] Нові міграції: чи є RLS POLICIES для нової таблиці?
- [ ] Нові міграції: чи є INDEX по tenant_id?

### Patterns

- [ ] Кожен agent слідує патерну: auth → startAgentRun → try/catch → finish/fail
- [ ] Кожен компонент: loading state (Skeleton) + error state
- [ ] Кожен UI рядок через `useT()` (нуль hardcoded тексту)
- [ ] Нові i18n ключі додані в ОБИДВІ мови (ua + en) в i18n.ts
- [ ] Money завжди в cents, форматується через `formatMoney()`

### Security

- [ ] Платіжні ключі — лише в server functions
- [ ] Немає secrets в client-side коді
- [ ] Storefront RPC — Security Definer (не виставляє приватні дані)

### UX

- [ ] Mobile responsive (375px — перевір уявно)
- [ ] Error toast через `sonner` при мутаціях (не при read)
- [ ] Success toast після збереження
- [ ] Loading кнопки з `disabled` і `Loader2` іконкою при pending

---

## ⛔ АБСОЛЮТНІ ЗАБОРОНИ

```
✗ НІКОЛИ не редагуй існуючі файли міграцій — лише нові файли
✗ НІКОЛИ не імпортуй supabaseAdmin в компоненти або client routes
✗ НІКОЛИ не хардкодь tenant_id, API keys, secrets
✗ НІКОЛИ не вводь нові UI бібліотеки (лише @radix-ui, shadcn/ui)
✗ НІКОЛИ не виставляй платіжні ключі в HTTP відповідях клієнту
✗ НІКОЛИ не ламай існуючий Telegram flow (telegram.*.ts)
✗ НІКОЛИ не видаляй DN Trade інтеграцію
✗ НІКОЛИ не міняй agentRuntime.ts — лише імпортуй з нього
✗ НІКОЛИ не пропускай RLS policies для нових таблиць
✗ НІКОЛИ не використовуй float для грошей — лише cents (integer)
✗ НІКОЛИ не здавай файл без перевірки tsc --noEmit
```

---

## 🎯 КЛЮЧОВИЙ ПРИНЦИП

MARQ вже має те, чого Shopify не матиме ніколи — **60+ автономних AI агентів**, які щохвилини аналізують бізнес і знаходять можливості. Agents.price-optimizer знаходить недооцінені товари. Agents.churn-risk передбачає відтік. Agents.ltv-predictor рахує цінність кожного клієнта.

Їм потрібна платформа, через яку ці знання перетворюються на гроші.

**Storefront** — щоб покупці купували.
**Email** — щоб поверталися.
**Promotions** — щоб платили більше.
**Loyalty** — щоб залишалися назавжди.

Збудуй це. Перевір двічі. Здай ідеально.
