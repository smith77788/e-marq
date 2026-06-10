---
name: Outcome Forecasting Layer
description: Кожен новий decision отримує payload.forecast (expected_revenue_cents, confidence, basis) через BEFORE INSERT trigger; basis priority = tenant_history(≥5) → blended → global_prior(≥3) → heuristic; backfill_decision_forecasts() для legacy
type: feature
---

`_forecast_for_action(tenant_id, action_type)` повертає jsonb з полями:

- `expected_revenue_cents` (bigint)
- `confidence` (0.25..0.95)
- `basis`: tenant_history | blended | global_prior | heuristic
- `tenant_samples`, `global_samples`, `tenant_winrate`, `global_winrate`

Trigger `trg_attach_forecast_on_decision` (BEFORE INSERT на decision_queue) автоматично додає forecast у payload, якщо його немає — застосовується до convert_insights_to_decisions, executor, manual inserts.

Heuristic priors (cents): cross*sell=250k, repeat_purchase=180k, winback=320k, dead_stock=150k, feature=200k, review=50k, ugc=80k, price_adjust=220k, owner*\*=0.

UI: `/brand/decisions` показує forecast як primary card-блок (UAH + впевненість + базис), а decisions сортуються в межах action-type групи за expected_revenue desc.

Telegram daily digest містить агрегат "💰 Потенціал inbox-у: X ₴" — суму forecast по всіх pending для tenant.

Backfill: `SELECT backfill_decision_forecasts()` (одноразово виконано після створення).
