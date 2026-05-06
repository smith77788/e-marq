## Наступний крок: Auto-scaling Budget Recommender (SQL Agent #22)

Беру №2 з минулого top-3 — він природно сідає поверх CAC Payback (#20) + LTV Forecaster (#19), які вже працюють. Без нього CAC-сигнали залишаються "passive read-only heatmap".

---

### Проблема

CAC Payback Agent уже знає:
- `cac_winner_channel` (швидкий payback, < 30 днів)
- `cac_payback_slow` (> 90 днів, токсичні канали)

LTV Forecaster знає predicted 12m LTV. Але **жодна дія не пропонується** — owner мусить сам інтерпретувати heatmap у `/brand/roi`.

### Рішення — `compute_budget_recommendations()` + `detect_budget_signals()`

**Pure-SQL, daily 05:15 UTC** (після CAC compute о 04:35 і LTV detect о 04:00):

1. **`budget_recommendations` таблиця** (UPSERT key: `tenant_id, period_month, channel`):
   - `current_spend_cents`, `recommended_spend_cents`, `delta_pct`, `rationale jsonb`, `confidence text`, `created_at`.

2. **`compute_budget_recommendations(p_tenant_id)`** для кожного активного `(tenant, channel)` за останні 60 днів:
   - Score = `(predicted_ltv_12m / cac) × (1 / max(payback_months, 0.5))`.
   - Channels ranked. Recommend:
     - score ≥ 3.0 і payback ≤ 45d → **scale +25%** (cap +50% від current).
     - score ≤ 1.0 або payback > 120d → **cut −30%**.
     - 1.0–3.0 → hold.
   - Confidence: `high` якщо n_orders ≥ 30, `medium` 10–29, `low` < 10 (тоді тільки рекомендуємо hold).

3. **`detect_budget_signals()`** emit insights:
   - `budget_scale_winner` (medium severity, action `owner_review` — manual за дизайном, бо це гроші) — для каналів з recommend +25%.
   - `budget_cut_loser` (high severity, action `owner_review`) — для каналів з recommend −30% при spend ≥ 5k UAH/міс.
   - Dedup per `(tenant, channel, current ISO week)` через semantic key.

### UI — `/brand/roi` нова секція "Budget Recommendations"

Компонент `BudgetRecommendationsTable.tsx`:
- Колонки: Channel · Current spend · Recommended · Δ% (badge зелений/червоний) · Predicted LTV · Payback · Rationale tooltip · Confidence.
- Sort by absolute delta_cents desc.
- Без mutation buttons — рекомендації приземляються в Decision Inbox через `owner_review`, owner approves там.

### Memory

- `mem://features/budget-recommender.md` — формула, schedule, dedup window, manual-by-design.
- Update `mem://index.md` (новий запис під CAC/LTV).

### Технічні деталі

**Migration 1:** `budget_recommendations` table + RLS (tenant own + super_admin).
**Migration 2:** `compute_budget_recommendations()` + `detect_budget_signals()` SECURITY DEFINER + cron `budget-recommender-daily` `15 5 * * *` (pure-SQL виклик через `cron.schedule` з `SELECT compute_budget_recommendations(t.tenant_id) FROM tenants t WHERE status IN ('active','pending')`).
**Frontend:** `src/components/owner/BudgetRecommendationsTable.tsx`, hook у `brand.roi.tsx` під CAC heatmap.

### Чому це безпечно

- Action type — `owner_review` (manual-by-design), НЕ потрапляє до executor whitelist. Гроші ніколи не списуються автоматично.
- Low-confidence (< 10 orders/channel) → завжди hold, ніяких сигналів.
- Cut-сигнал тільки при spend ≥ 5k UAH/міс — щоб не спамити малими каналами.
- Skip pilot tenants у `detect_budget_signals` (synthetic дані ввели б в оману).

~30 хв роботи. Кажи "ок" — починаю.
