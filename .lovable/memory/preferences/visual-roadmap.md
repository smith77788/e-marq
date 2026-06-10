---
name: Visual / UX roadmap
description: Pending UI improvements — polish visuals, dark/light toggle, charts driven by ai_insights + DB
type: preference
---

**Why**: Власник просив зробити дашборд приємнішим і зрозумілішим. Зараз UI функціональний, але сухий.

**How to apply**: При кожному наступному UI-touch на /brand та /admin/tenants, поступово додавати:

1. **Dark/Light toggle** — в `src/routes/_authenticated.tsx` поряд з `LanguageSwitcher`. Зберігати в localStorage, ставити `class="dark"` на `<html>`. Token система вже готова в `src/styles.css` (oklch) — треба лише задати `.dark` варіанти.
2. **Візуал**: more whitespace, subtle gradients на KPI cards, animated number counters (framer-motion), micro-interactions на hover, icon-led headers замість плоского тексту.
3. **Діаграми з insights/БД** (recharts вже встановлений):
   - Insights heatmap: insight_type × day (за 30д) — показує які агенти зараз шумлять
   - Margin waterfall: top-10 продуктів з product_costs vs price_cents → bars
   - LTV distribution: histogram по customer_ltv_scores.predicted_ltv_cents
   - Cart funnel: events (page_view → add_to_cart → checkout_started → purchase_completed) — funnel chart
   - Agent health: agent_health.health_score за 30д — line per agent
   - Cohort retention: customer_cohorts.retention_curve — heatmap
4. **Skeleton loaders** замість "Loading…" текстів.
5. **Empty states** з ілюстраціями замість порожніх карток.

Робити поступово, не одним великим релізом. Перший крок — dark/light toggle + 1-2 діаграми.
