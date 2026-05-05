---
name: CAC Payback Agent
description: SQL agent #20, daily 04:35 compute_cac_payback() + hourly :42 detect_cac_signals(); reads acquisition_costs + customer_cohorts, emits cac_payback_slow / cac_winner_channel insights
type: feature
---
**Tables:**
- `acquisition_costs(tenant_id, period_month, channel, spend_cents, new_customers, notes)` — owner вводить marketing spend помісячно. RLS: members read, admins write.
- `cac_payback_metrics(tenant_id, cohort_month, channel, cac_cents, customer_count, revenue_m1/3/6/12_cents, payback_month, ltv_12m_cents, roi_pct)` — computed by agent. RLS: members read, system writes.

**Cron:**
- `compute-cac-payback-daily` 04:35 UTC → `compute_cac_payback()`: joins customer_cohorts × acquisition_costs по period_month=cohort_month, рахує per-customer cumulative revenue, payback_month = перший offset де cum/customer >= CAC. UPSERT.
- `detect-cac-signals-hourly` :42 → `detect_cac_signals()`: scan recent (computed_at <36h, cohort <6mo old):
  - `payback_month > 6` OR NULL → insight `cac_payback_slow` (medium, finance layer)
  - `roi_pct >= 200` & customer_count≥5 → insight `cac_winner_channel` (low risk)
- Skip pilot tenants.

**UI:** `CacPaybackTable` у `/brand/roi` — таблиця cohort × channel з payback heatmap (oklab color-mix: green=fast, red=unprofitable). Empty state guides до /brand/settings → Marketing spend (TODO form).

**Decision flow:** обидва insight types конвертуються у decision через `convert_insights_to_decisions` як `owner_review` action → manual approval (стратегічне рішення).
