---
name: Value-aware auto-approval + Risk Guardrails
description: auto_approve_eligible_decisions() сортує pending за forecast.expected_revenue desc; пропускає (з skip_reason) high_value_low_confidence (>500₴ + conf<0.4) і daily_cap_reached (>20 auto/24h per tenant); UI показує "🛡️ Високий ризик" badge
type: feature
---

Розширення Phase 9 auto-approval policy:

**Ordering**: `ORDER BY (payload->forecast->expected_revenue_cents) DESC, created_at ASC` — найцінніші дії auto-approve-ляться першими у межах cron-tick.

**Risk guardrails** (skip + tag, але НЕ approve):

- `high_value_low_confidence`: expected ≥ 50000 cents (500₴) AND confidence < 0.4 → залишити owner-у
- `daily_cap_reached`: вже ≥ 20 auto-approved decisions для tenant за останні 24h

При skip: UPDATE `payload.auto_approval_skip_reason` + `auto_approval_skipped_at` (idempotent — не оновлює якщо причина та сама).

UI у `/brand/decisions`: badge "🛡️ Високий ризик" / "Денний ліміт" поряд з age-badge на DecisionCard, з tooltip-пояснення.

Calibration loop вирівнює це автоматично: коли action_outcomes накопичить історію → `_forecast_for_action` повертає confidence > 0.4 (basis=tenant_history) → high_value_low_confidence guardrail розблоковує дії. Daily cap НЕ scaling — навмисно жорсткий, щоб уникнути runaway loops при будь-якому bug у insight-генерації.
