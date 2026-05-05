---
name: LTV Forecasting Agent
description: SQL agent #19, daily 03:45 compute_ltv_forecasts + 04:00 detect_ltv_signals; multiplier-based 12m LTV prediction from m30; emits ltv_below_cac_floor + ltv_breakout_cohort
type: feature
---

## Що робить
Прогнозує 12-month LTV когорти з перших 30 днів `customer_cohorts.revenue_curve` (це масив monthly per-customer increments).

## Multiplier
- Tenant-specific: median(`sum(rev_curve[1..12]) / rev_curve[0]`) серед mature cohorts (вік ≥ 12 міс, m0 > 0).
- Confidence: high якщо n_mature ≥ 6, medium якщо 3-5, low → fallback на global cross-tenant median.
- Bootstrap default = 4.0 (типове D2C співвідношення).
- Якщо cohort вже має ≥12 buckets — беремо реальну суму (`source='actual'`, `confidence=high`).

## Signals
1. **`ltv_below_cac_floor`** (severity high) — predicted_ltv_12m < avg_CAC × 1.2 за останні 3 місяці. Action `owner_review`.
2. **`ltv_breakout_cohort`** (severity medium) — нова когорта ≥ 1.5× медіани попередніх 6. Action `owner_review` ("що ми робили інакше?").

## Розклад
- `ltv-forecaster-compute-daily` — `45 3 * * *`
- `ltv-forecaster-detect-daily` — `0 4 * * *` (після CAC compute о 04:35? — ні, 04:00 раніше; CAC потрібен detect — якщо ще немає CAC, signal просто пропускається)

## Чому це закриває loop
- CAC Payback (#20) дає cost. LTV Forecaster (#19) дає revenue prognosis. Разом — повноцінна unit-economics автоматизація.
- Pilot tenants пропускаються у detect (skip is_pilot=true).

## Залежності
- `customer_cohorts` (cohort engine) — обов'язково має заповнюватись.
- `acquisition_costs` (Marketing Spend UI) — без неї `ltv_below_cac_floor` ніколи не спрацює, тільки breakout.
