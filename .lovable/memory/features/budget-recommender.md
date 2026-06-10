---
name: Budget Recommender
description: SQL agent #22, daily 05:15, scores LTV/CAC × payback per channel, emits budget_scale_winner / budget_cut_loser as owner_review (manual-by-design)
type: feature
---

## Що робить

Pure-SQL daily агент, що дивиться на acquisition_costs (60d), cac_payback_metrics (6mo), ltv_forecasts → видає рекомендацію scale/hold/cut на канал.

## Формула

- score = (LTV / CAC) × (1 / max(payback_months, 0.5))
- scale: score ≥ 3.0 і payback ≤ 1.5 міс → +25% (cap 1.5×)
- cut: score ≤ 1.0 АБО payback > 4 міс → −30%
- hold: інше
- Confidence: high (n≥30), medium (10-29), low (<10) → завжди hold

## Signals

- `budget_scale_winner` (medium) — будь-який scale candidate
- `budget_cut_loser` (high) — лише якщо current_spend_cents ≥ 5k UAH
- Action `owner_review` — manual-by-design, гроші ніколи автоматично
- Dedup: per (tenant, channel, type, ISO week)
- Skip pilot tenants

## Розклад

- `budget-recommender-daily` `15 5 * * *` — pure-SQL fan-out по active tenants

## UI

- `BudgetRecommendationsTable` під CacPaybackTable у `/brand/roi` — read-only, sort by abs delta_cents
