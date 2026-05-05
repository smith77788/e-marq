---
name: Cohort Retention Engine
description: SQL agent #18, daily 03:45, compute_customer_cohorts() UPSERT 12-month cohorts × 12-month retention/revenue curves у customer_cohorts; skip pilot
type: feature
---

## Що робить
`compute_customer_cohorts()` SECURITY DEFINER — для кожного активного non-pilot тенанта:
1. Бере `customers` із first_order_at у межах 12 останніх місяців
2. JOIN `orders` по `lower(customer_email) = lower(customers.email)` (orders НЕ має FK customer_id) AND status IN ('paid','fulfilled')
3. Рахує `month_offset = (year_diff*12 + month_diff)` між order_month і cohort_month
4. UPSERT у `customer_cohorts (tenant_id, cohort_month, customer_count, retention_curve jsonb, revenue_curve jsonb)`
   - retention_curve: `[{m:0,c:active},{m:1,c:active}...]`
   - revenue_curve: `[{m:0,r:cents},...]`

## Розклад
`45 3 * * *` (cron `compute-cohorts-daily`). Skip pilot tenants — синтетичні replenish-orders спотворюють retention.

## Підводні камені
- OUT params треба було перейменувати у `out_tenant_id`/`out_cohorts_written` — інакше `ON CONFLICT (tenant_id, ...)` плутає plpgsql variable з колонкою
- order_status enum: тільки `('pending','paid','fulfilled','cancelled','refunded')` — `delivered/shipped/completed` НЕ існують

## Користь
- UI може малювати справжній retention heatmap із backend-агрегацією замість клієнт-side апроксимації по first/last_order_at
- Відкриває шлях до CAC payback / LTV-by-cohort аналітики
