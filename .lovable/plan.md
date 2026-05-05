# Decision Inbox / Insights UI — batch upgrade

Все робиться у вже існуючому файлі `src/routes/_authenticated/admin.decisions.tsx` (Decision Inbox) + `src/routes/_authenticated/admin.insights.tsx` (новий, лише якщо знадобиться — наразі ні). Дані вже доступні через `decision_queue`, `ai_insights`, `action_outcomes`, `product_metrics_daily`. Нічого в БД додавати не треба.

## 1. Кнопка copy-to-clipboard на кожному JSON/text-блоці

В `DecisionDetailDialog` і `InsightDetailDialog`:
- Невелика обгортка `<CopyButton value={...} />` у правому верхньому куті кожної секції: Rationale, Payload, Expected impact, Insight metrics, semantic_key.
- Використати `navigator.clipboard.writeText` + `toast.success("Скопійовано")`.
- Іконка `Copy` з lucide-react, `variant="ghost"`, `size="icon"`.

## 2. Фільтр за `risk_level` і `confidence` у Decision Inbox

`decision_queue` сам не має `risk_level` — він живе на `ai_insights`. Підхід:
- При завантаженні decisions додатково тягнути linked insight `risk_level` через окремий запит `ai_insights.select('id, risk_level').in('id', insightIds)` і збагатити рядки в memory (Map по `insight_id`).
- Додати у блок Filters:
  - чіпи `low / medium / high / unknown` для risk;
  - повзунок (`Slider` shadcn) "min confidence", 0–100%, default 0.
- Фільтрація — клієнтська, після `load()`.
- Колонка "Risk" у таблиці з кольоровим Badge.

## 3. Відкривати споріднені decisions прямо з картки insight

В `InsightDetailDialog` уже є секція "Породжені decisions". Зробити кожен рядок клікабельним:
- При кліку — `setInsightView(null)` і `openDetail(d)` (відкрити Decision Detail).
- Курсор `cursor-pointer`, hover-фон `hover:bg-muted/50`.
- Дрібна іконка `ArrowUpRight` справа.

Прокинути `onOpenDecision: (d: Decision) => void` proр з parent → `InsightDetailDialog`.

## 4. Sparkline тренду метрик insight за 7 днів

В `InsightDetailDialog` додати секцію "Тренд (7 днів)":
- Якщо `insight.metrics.product_id` присутній → SELECT з `product_metrics_daily` останні 7 днів (`day, units_sold, revenue_cents, stock_on_hand`).
- Якщо `metrics.customer_id` присутній → з `customer_metrics_daily` (orders_count, revenue_cents).
- Якщо нічого з цього немає — секція ховається.
- Рендер через існуючий `<Sparkline data={…} />` з `src/components/detail/Sparkline.tsx`.
- Дві лінії максимум: основна метрика (revenue) + допоміжна (units / stock).

## 5. Bulk-export pending decisions у CSV

В `AdminDecisionsPage` біля кнопок "Схвалити / Відхилити" — кнопка "Експорт CSV":
- Бере поточний відфільтрований масив (`decisions`, з урахуванням risk/confidence фільтра).
- Конвертує у CSV рядок: `id, tenant_id, tenant_name, action_type, title, agent_id, status, confidence, risk_level, created_at, age_hours, rationale`.
- Екранує лапки/коми, скачує як `decisions-YYYY-MM-DD.csv` через `Blob` + `URL.createObjectURL` + тимчасовий `<a download>`.
- Без сервер-функції, чисто клієнтський експорт.

## Технічні деталі

**Файли:**
- `src/routes/_authenticated/admin.decisions.tsx` — основні правки (state, filters, dialog).
- `src/components/admin/CopyButton.tsx` — нова крихітна reusable кнопка copy-to-clipboard.

**Нові імпорти:** `Copy`, `ArrowUpRight` (lucide), `Slider` (shadcn).

**Запити БД, що додаються (клієнтські, через `supabase` browser client, RLS пропускає super_admin):**
- `ai_insights.select('id, risk_level').in('id', insightIds)` під час `load()`.
- `product_metrics_daily` / `customer_metrics_daily` — лише в `InsightDetailDialog` коли є відповідний id у `metrics`.

**Без міграцій.** Без edge functions. Без правок RLS.

## Що НЕ входить у цей план (з твого списку)

Інші пункти (Schedule for later, /admin/agents/:id, timeline, heatmap, semantic_key, /admin/outcomes, /admin/health live, alert-banner, force-tick, /admin/pilot) — більші фічі, кожна потягне окремі endpoint'и/міграції/UI. Зробимо їх окремими планами після цього раунду, коли цей merge'не.
