## Наступний батч — Прозорість агентів

З твого списку йдемо в порядку: після **Decision Inbox UX** (зроблено) — блок **Прозорість агентів**. Це 4 пункти:

1. `/admin/agents/$agentId` — admin-екран по конкретному агенту з останніми запусками, latency і error rate **через всі tenants** (існуючий `/agents/$agentId` показує лише поточний tenant).
2. Графік **щоденних запусків агента per tenant** на тому ж екрані (heatmap day×tenant, останні 14 днів).
3. **Auto-approval heatmap** `action_type × tenant` на `/admin/decisions` (нова вкладка/секція "Heatmap").
4. Показати **`semantic_key`** у Decision Detail (є в `decision_queue.payload.semantic_key`, додати рядок з copy-кнопкою).

### Файли

**Новий:** `src/routes/_authenticated/admin.agents.$agentId.tsx`
- Guard: `useAuth().isSuperAdmin`, інакше `Navigate to="/dashboard"`.
- Параметр `agentId`. Header: `humanizeAgentId`, badge категорії з `getAgentMeta`, кнопка "← усі агенти" (поки лінк на `/admin/health`).
- Зведені метрики (24h, 7d): runs_total, runs_failed (% fail rate), avg latency (`finished_at - started_at`), insights_created. Запит у `acos_agent_runs` без фільтра по tenant (super-admin RLS пропускає).
- Таблиця "Per-tenant 7d": агрегація по tenant_id → join `tenants(name)`. Колонки: tenant, runs, fail %, insights, last_run.
- Heatmap "Запуски по днях × tenant" (14 днів): простий grid div'ів, інтенсивність кольору від кількості runs. Tooltip з числом.
- Список останніх 30 runs (cross-tenant) з tenant_name, status, latency, error.

**Новий:** `src/components/admin/AutoApprovalHeatmap.tsx`
- Props: `decisions: Decision[]` (вже завантажені на `/admin/decisions`).
- Групує по `action_type × tenant_name`, рахує counts та `auto_approved` (де `payload.approval_mode in ('history','bootstrap')` АБО `decided_by = 'system'`).
- Рендер: компактна таблиця-grid; cell color = green коли auto_approved/total високе, yellow змішане, gray manual-only. Tooltip з ratio.

**Edit:** `src/routes/_authenticated/admin.decisions.tsx`
- Додати Tabs ("Inbox" | "Auto-approval heatmap"), або секцію <Collapsible> зверху "Heatmap". Beрсія простіша — Collapsible-блок з `<AutoApprovalHeatmap decisions={decisions} />` (без додаткових запитів, працює на вже завантажених decisions).
- У `DecisionDetailDialog`: відрендерити `payload.semantic_key` (якщо є) окремим рядком у секції meta з `<CopyButton />`.

**Edit:** `src/components/layout/AppSidebar.tsx` (super-admin section) — додати лінк "Agents (admin)" → `/admin/agents/...`. Оскільки це per-id, лінк веде на список через `/admin/health` (там уже є агенти у tenant-картках) АБО додати простий index `/admin/agents` з grid-listingом унікальних `agent_id` за 7d. Зроблю мінімально — index сторінку **`src/routes/_authenticated/admin.agents.index.tsx`** з grid карток (агент → runs/fail % за 7d, лінк на deep-dive).

### БД

Жодних міграцій. Усі дані з:
- `acos_agent_runs(tenant_id, agent_id, status, started_at, finished_at, insights_created, error)`
- `tenants(id, name)` (для join по tenant_name)
- `decision_queue` — вже завантажується на /admin/decisions

Запити клієнтські через `supabase`, RLS пропускає super_admin.

### Що НЕ входить

- "Schedule for later" (потребує колонки `snoozed_until` у decision_queue) — окремий план.
- Live-dashboard `/admin/health` rewrite, alert-banner у sidebar, force-tick кнопка — окремий план "Pipeline health".
- `/admin/outcomes` win-rate dashboard — окремий план "Measurement loop".
- `/admin/pilot` simulator control — окремий план "Pilot".

Після merge цього — наступний крок: **Measurement loop** (`/admin/outcomes`).