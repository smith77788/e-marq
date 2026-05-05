# Наступні 2 кроки

Беру два пов'язані покращення з top-3, які доповнюють одне одного:

## 1. SQL Agent #20 — CAC Payback Agent

**Мета:** показати власнику, скільки часу займає окупити витрати на залучення клієнта (Customer Acquisition Cost), і виявити **збиткові канали/когорти**, де LTV < CAC після N місяців.

**Логіка (pure-SQL, як решта SQL-агентів):**
- Нова таблиця `acquisition_costs(tenant_id, period_month, channel, spend_cents, new_customers)` — owner вводить вручну або імпортує (Meta Ads, Google Ads).
- Функція `compute_cac_payback()` (daily 04:35 UTC):
  - Для кожної когорти `customer_cohorts` (вже існує) рахує cumulative revenue per customer на 1/3/6/12 month offsets.
  - Joins з `acquisition_costs` по `period_month` → CAC = spend / new_customers.
  - Payback month = перший offset де `cumulative_revenue_per_customer >= CAC`.
  - Записує у нову таблицю `cac_payback_metrics(tenant_id, cohort_month, channel, cac_cents, payback_month, ltv_12m_cents, roi_pct)`.
- Функція `detect_cac_signals()` (hourly :42):
  - Якщо `payback_month > 6` АБО `ltv_12m < cac` → insight `cac_payback_slow` → action `owner_review` (manual, бо рішення про канал — стратегічне).
  - Якщо `roi_pct > 200%` для каналу 3+ місяці поспіль → insight `cac_winner_channel` → action `owner_review` (натяк збільшити budget).

**UI:**
- Новий tab "CAC & Payback" у `/brand/roi` з таблицею cohort × channel і кольоровою heatmap по payback month.
- На `/brand/index` (CockpitHero) — мінімальний badge "Avg payback: 4.2 mo" якщо є дані.

## 2. Notification Digest dedup

**Проблема:** користувач щойно скаржився на спам сповіщень. Pilot-guard вже додано, але **реальні tenants теж страждатимуть** від множинних сповіщень одного типу за годину.

**Рішення:**
- Розширити trigger `tg_notify_owner_on_notification`:
  - Перед INSERT у `owner_telegram_outbox` перевіряти: чи є вже pending row для (tenant, kind) у останні 60 хв?
  - Якщо так → не створювати новий outbox row, а **оновити існуючий** з лічильником `payload.batched_count` і списком останніх 3 titles.
- Telegram template для batched: `"🔔 {kind}: 5 нових подій за останню годину\n• ...\n• ...\n• ...\n[Відкрити Inbox]"`.

## Технічні деталі

**Migrations (4):**
1. `acquisition_costs` table + RLS (tenant_admin write, member read).
2. `cac_payback_metrics` table + indexes (tenant_id, cohort_month, channel).
3. `compute_cac_payback()` + `detect_cac_signals()` functions + 2 cron jobs з CRON_SECRET.
4. Update `tg_notify_owner_on_notification` trigger для batching + add `batched_count` column to `owner_telegram_outbox.payload`.

**Frontend:**
- `src/components/owner/CacPaybackTable.tsx` — heatmap cohort × channel.
- `src/routes/_authenticated/brand.roi.tsx` — додати tab.
- (опційно) UI для введення `acquisition_costs` — простий form у `/brand/settings` → "Marketing spend".

**Memory:**
- `mem://features/cac-payback-agent.md`
- `mem://features/notification-digest.md`
- Update `mem://index.md`.

## Чому ці два разом

CAC Payback — стратегічний insight (нова можливість), digest — тактичний QoL fix (зменшує тертя від п.5 минулого повідомлення). Разом ~30 хв роботи, обидва — pure-SQL + tiny UI, не блокують одне одного.

Кажи "ок" — починаю.