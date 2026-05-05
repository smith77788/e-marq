## Наступний крок: Auto-Resume Policy + Marketing Spend UI

Беру №1 і №2 з top-3 минулого кроку — вони доповнюють CAC Payback Agent (закривають його loop) і знімають останнє тертя auto-pause системи.

---

### 1. Auto-Resume Policy (SQL Agent #18)

**Проблема:** `auto_pause_policies_on_quality_drop()` (#17) виключає policy коли win-rate падає, але **немає зворотного шляху**. Owner мусить вручну re-enable, що ламає autonomous-loop.

**Рішення — `auto_resume_policies_on_recovery()`:**
- Daily 06:45 UTC (одразу після #17 о 06:30).
- Сканує `auto_approval_policy WHERE enabled=false AND notes LIKE '%auto-paused%'`.
- Для кожної paused policy перевіряє останні 14 днів `action_outcomes` для (tenant, action_type):
  - n ≥ 5 done outcomes
  - win-rate ≥ 50% (vs threshold 30% у #17)
  - середній attributed_revenue_cents > 0
- Якщо так → `UPDATE auto_approval_policy SET enabled=true`, додає note `auto-resumed YYYY-MM-DD: win=X% n=Y`.
- Шле owner_notification (kind='auto_resumed_policy', severity=info, channel=telegram).
- Dedup: ту ж policy не resume'ить повторно у 7-day window.

**Чому це безпечно:** quality_monitor (#16) і causal-disable (Welch t-test) лишаються активними. Якщо resume був передчасний, ці агенти знову paused його за 1-2 тижні.

---

### 2. Marketing Spend UI (`/brand/settings` → tab "Marketing")

CAC Payback Agent має таблицю `acquisition_costs`, але owner ніяк її не заповнює. Без даних — порожня heatmap у `/brand/roi`.

**`MarketingSpendForm.tsx`:**
- Таблиця: рядок per (period_month, channel) з inline-edit полями `spend_cents` (UAH input), `new_customers`.
- Auto-suggest channels з `customer_cohorts.acquisition_channel` distinct values + manual input.
- Header: dropdown month picker (last 12 months), default = current month.
- "Add row" → новий empty row, зберігає на blur.
- "Imported from Meta Ads / Google Ads" — placeholder, поки manual.
- RPC `upsert_acquisition_cost(tenant_id, period_month, channel, spend_cents, new_customers)` — UPSERT по (tenant_id, period_month, channel).

**Інтеграція в settings:**
- `brand.settings.tsx` має tabs structure → додати tab "Marketing".

---

### Технічні деталі

**Migrations (2):**
1. `auto_resume_policies_on_recovery()` SECURITY DEFINER функція + cron `auto-resume-policy-daily` (45 6 * * *) з CRON_SECRET.
2. RPC `upsert_acquisition_cost()` SECURITY DEFINER (tenant_admin only check).

**Frontend:**
- `src/components/owner/MarketingSpendForm.tsx` — таблиця з editable cells.
- `src/routes/_authenticated/brand.settings.tsx` — додати tab.

**Memory:**
- `mem://features/auto-resume-policy.md`
- Update `mem://features/cac-payback-agent.md` (link на UI) і `mem://index.md`.

---

### Чому ці два разом

Обидва закривають loops з минулого кроку:
- Auto-resume → завершує quality-drop pause cycle (decision system fully autonomous).
- Marketing UI → активує CAC Payback Agent даними.

~25 хв роботи, обидва — pure-SQL + tiny UI, не блокують одне одного.

Кажи "ок" — починаю.