# Project Memory

## Core
ACOS = головний продукт: multi-tenant Autonomous Revenue OS для D2C-брендів.
Архітектура за зразком My Food Diary: ai_insights → orchestrator → 1-click apply → ai_memory feedback loop.
Storefront/Products/Orders = вторинна "commerce shell", не основа продукту.
Нові фічі будують ACOS-агенти (cron edge functions які пишуть insights), не e-commerce.
Auto-apply with approval queue: агенти пропонують дії, власник апрувить батчами.
First pilot tenant = MFD-like синтетичний 90-day dataset.
Внутрішні артефакти (магніти, content_pages, drafts, insights body) у адмінці завжди показувати inline через Dialog/Drawer — не редіректити на публічні /m/ /s/ сторінки.
Forecasting layer: BEFORE INSERT trigger на decision_queue додає payload.forecast (expected_revenue + confidence + basis) → відображається в Decision Inbox і в Telegram digest.

## Memories
- [MARQ Roadmap](mem://features/marq-roadmap) — спринти 1-12, Outreach Hunter, Site Builder, Email automations, inline preview правило.
- [Forecasting](mem://architecture/forecasting) — _forecast_for_action() + trigger; basis ladder tenant_history → blended → global_prior → heuristic; UI sorts pending by expected_revenue desc
- [Forecast calibration](mem://architecture/forecast-calibration) — daily compute_forecast_calibration() vs action_outcomes; MAPE/bias/hit-rate per action_type у forecast_calibration; UI "Точність прогнозу AI" на /brand/insights
- [Value-aware auto-approval](mem://features/value-aware-auto-approval) — ORDER BY forecast.expected_revenue desc + guardrails (high_value_low_confidence, daily_cap=20/24h); skip_reason у payload; UI guardian badge
- [Morning Brief digest](mem://features/morning-brief) — daily 08:00 UTC narrative Telegram з time saved, top win, guardian count, forecast потенціал; FIX 04-29: tenants.id (не tenant_id)
