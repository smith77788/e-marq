---
name: ROI Dashboard
description: /brand/roi сторінка з get_owner_roi_summary RPC; cumulative actions, time saved (8min/action), attributed revenue, win-rate, top action, 14d trend, breakdown by action_type
type: feature
---

Phase 18: Owner-facing ROI panel.

**Route**: `/brand/roi` → `src/routes/_authenticated/brand.roi.tsx` → `<ROIDashboard />`.

**Data source**: `public.get_owner_roi_summary(_tenant_id uuid) RETURNS jsonb`:

- total_actions (decision_queue.status='done')
- time_saved_minutes/hours (8 min × actions, same constant as morning brief)
- total_revenue_cents (SUM action_outcomes.attributed_revenue_cents)
- win_rate_pct (% measured outcomes with attributed_revenue_cents > 0)
- avg_lift_pct (AVG action_outcomes.lift_pct)
- top_action (action_type with highest revenue)
- by_action[] (per-type breakdown, top 20 by revenue)
- trend_14d[] (daily actions + revenue)

**Sidebar**: GROWTH group, after `sb.acosLoop`, key `sb.roi`, icon `Coins`.

**Note**: Поки нет вимірюваних outcomes (24h gate), revenue/win-rate/lift показуються як "очікуємо вимірів". Перші виміри після ~04:30 UTC.

**Constants alignment**: 8min/action узгоджено з `send_owner_daily_digest` (Phase 17 morning brief).
