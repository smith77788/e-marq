---
name: Forecast Calibration Loop
description: Daily compute_forecast_calibration() порівнює forecast.expected_revenue (на момент створення decision) vs action_outcomes.attributed_revenue (виміряно 24h+ пізніше); зберігає MAPE/bias/hit-rate у forecast_calibration; UI блок "Точність прогнозу AI" на /brand/insights
type: feature
---

Таблиця `public.forecast_calibration`:
- `tenant_id` (NULL = global rollup), `action_type`, `computed_at`
- `sample_size`, `avg_forecast_cents`, `avg_actual_cents`
- `bias_cents` (actual − forecast: >0 = AI недооцінює, <0 = переоцінює)
- `mape_pct`, `hit_rate`, `median_ratio`

Cron `compute-forecast-calibration-daily` (04:30 UTC) вставляє один рядок per (tenant, action_type) + один global rollup. Зберігає 90 днів історії.

`get_forecast_calibration(_tenant_id)` повертає latest snapshot per action_type, prefer tenant scope, fallback global. Tenant access через tenant_memberships.

UI: `/brand/insights` → `ForecastCalibration` показує per action_type: прогноз/факт/bias/MAPE/hit-rate. Empty state до першого вимірювання.

Майбутнє: priors у `_forecast_for_action()` можна автокалібрувати multiplier-ом median_ratio коли sample_size ≥ 10 — поки що відкладено, бо forecast = self-referential через trigger; потрібен okремий "calibrated_expected_cents" або периодичний UPDATE на нові decisions.
