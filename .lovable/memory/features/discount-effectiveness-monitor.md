---
name: Discount Effectiveness Monitor
description: SQL agent #24, daily 06:30, margin-aware post-mortem застосованих знижок; actual_margin<0 → discount_loss_maker (high), <50% expected → discount_underperforming (medium); owner_review_rules
type: feature
---

## Що робить
Pure-SQL daily агент. Для done-decisions з action_type IN ('discount_dead_stock','price_adjust') за 14d з attributed_revenue_cents>0:
- actual_margin = revenue − cogs × units_estimated
- expected_margin = revenue × (1 − discount_pct) − cogs × units
- ratio = actual / expected
- actual<0 → `discount_loss_maker` (high)
- ratio<0.5 → `discount_underperforming` (medium)
- Action: `owner_review_rules` (manual — сигнал переглянути auto-approval whitelist)

## Дедуп / гард
- (tenant, insight_type, product_id, ISO week_start) → bit(60)::bigint
- 14d window
- Skip pilot tenants
- Потребує product_economics.cogs_cents > 0 (інакше CONTINUE)

## Розклад
`detect-discount-effectiveness-daily` `30 6 * * *` — pure-SQL, без HTTP

## Чому це треба
Margin-aware Decisioning + auto-approval вже працюють, але після execution ніхто не перевіряв чи реальна маржа збігається з очікуваною. Це closing loop для discount-агентів — high-severity loss_maker сигналить owner-у переглянути правила.
