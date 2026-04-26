# Self-Healing Agent в адмінці

## Важливо: чесно про межі можливого

Ти просиш "агента з повними правами щоб робив все замість мене" — потрібно відразу розмежувати, що **технічно можливо**, а що **ні**, бо інакше буде недовіра до результату.

### ❌ Чого агент у браузері НЕ може (фізично)
- Редагувати вихідний код проекту (`.tsx` файли). Код змінює лише Lovable-агент через мене — це закрита система.
- Деплоїти нові версії сайту.
- Створювати міграції БД на льоту.
- Запускати `npm install` чи додавати залежності.

> Будь-хто, хто пообіцяє "агента що сам пише код у вашому Lovable-проекті з адмінки" — обманює. Lovable-білд закритий.

### ✅ Що агент МОЖЕ робити автономно (і це багато)
Він працює як **operations brain** — фіксить **конфіг, дані, налаштування, runtime-стани**, які і складають 90% реальних інцидентів у продакшені:

1. **Моніторити** — читати `agent_runs`, `outreach_actions`, `email_sends`, `orders`, `dntrade_health`, balance, RLS-помилки, edge-function logs.
2. **Діагностувати** — групувати помилки в інциденти (INC-XXXX), визначати severity (P0–P3), root cause.
3. **Авто-лікувати безпечно** (whitelist дій, кожна reversible):
   - Перепланувати failed `outreach_actions` з transient-помилками
   - Авто-паузити канал який має >5 fails / <2 success за 24h
   - Знімати "stuck" `pending` ордери старші 48h → `pending_review`
   - Перезапускати застряглі `agent_runs` зі статусом `running` >30хв
   - Вимикати агент, який падає 5 разів поспіль (kill-switch)
   - Збільшувати `retry_count`, обнуляти rate-limit лічильники
   - Чистити прострочені `notifications` / `aiAskHistory`
4. **Пропонувати** (з кнопкою Apply, не авто) — все що ризикованіше: масові апдейти, зміни тарифу, пересилання email.
5. **Блокувати** — фікси, де regression risk = HIGH.

---

## Архітектура

```text
┌─────────────────────────────────────────────────────────────┐
│  /admin/self-heal  (нова сторінка в адмінці, super-admin)  │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │ Incidents│  │ Auto-Heal Log│  │ Health Dashboard   │   │
│  │  Queue   │  │  (last 100)  │  │ (5 modules status) │   │
│  └──────────┘  └──────────────┘  └────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Pending Proposals (потребують Apply від адміна)    │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  [▶ Run Cycle Now]  [⏸ Auto-Heal: ON/OFF]  [⚙ Rules]      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
        POST /hooks/agents/self-heal-engine
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       DETECT         ANALYZE       APPLY/PROPOSE
     (читає 6+      (групує в      (whitelist
      таблиць)       INC-XXXX)      dії, лог)
                          │
                          ▼
               self_heal_incidents (нова таблиця)
               self_heal_actions   (нова таблиця)
```

---

## Що буду робити (по кроках)

### 1. БД (міграція)
- `self_heal_incidents` — `id, tenant_id, code, severity (p0-p3), title, root_cause, scope_json, regression_risk, status (open|fixing|fixed|blocked|monitoring), created_at, resolved_at`
- `self_heal_actions` — `id, incident_id, kind, payload_json, decision (apply|propose|block|monitor), applied_at, applied_by, reversible, revert_payload`
- `self_heal_settings` — `key, value` (auto-heal on/off, allowed kinds, severity-threshold)
- RLS: лише super_admin читає/пише.

### 2. Бекенд-движок
- **`POST /hooks/agents/self-heal-engine`** — головний цикл. Авторизація: cron-token АБО super_admin JWT. Запускає всі детектори по черзі, створює інциденти, виконує whitelist auto-heal дії.
- **`POST /hooks/agents/self-heal-apply`** — застосовує конкретну `propose`-дію після кліку адміна.
- **`POST /hooks/agents/self-heal-revert`** — відкочує дію (зберігаємо `revert_payload`).
- pg_cron щохвилини викликає engine (як `agents.tick`).

### 3. Детектори (в `src/lib/self-heal/detectors/`)
Кожен — чиста функція `(tenantId) → Incident[]`:
- `outreachFailures.ts` — transient fails → reschedule
- `agentRunsStuck.ts` — `running` >30хв → reset
- `agentRunsFailing.ts` — 5 fails поспіль → kill-switch
- `dntradeStale.ts` — sync >24h → propose re-sync
- `emailBounces.ts` — bounce-rate >5% → propose pause sender
- `ordersStuck.ts` — `pending` >48h → flag for review
- `balanceDepleted.ts` — balance <0 → propose top-up reminder
- `rlsErrors.ts` — читає postgres_logs за останню годину

### 4. Auto-Heal Engine (`src/lib/self-heal/engine.ts`)
- `runCycle()` — викликає всі детектори, dedupe по `code+scope`, для кожного інциденту → `decideAction()`.
- `decideAction()` — логіка APPLY/PROPOSE/BLOCK/MONITOR на основі severity + regression risk + whitelist.
- Whitelist (auto-apply без аппрува): `reschedule_outreach`, `reset_stuck_agent_run`, `kill_failing_agent`, `cleanup_expired_notifications`. Все інше → PROPOSE.

### 5. UI — `src/routes/_authenticated/admin.self-heal.tsx`
- **Health Dashboard** — 5 карток (Detector / Root Cause / Isolation / Auto-Fix / Regression Guard) зі статусом OK/WARN/FAIL.
- **Incidents Queue** — таблиця активних інцидентів (severity badge, root cause, scope, кнопки Apply/Block/Revert).
- **Auto-Heal Log** — останні 100 виконаних дій з кнопкою "Revert".
- **Pending Proposals** — окремий список з action-кнопками.
- **Settings panel** — toggle Auto-Heal ON/OFF, вибір allowed kinds, severity threshold.
- Realtime — підписка на `self_heal_incidents` через Supabase channel.
- Доступ: `useAuth().isSuperAdmin === true` (інакше redirect на `/admin`).

### 6. Інтеграція в адмінку
- Додаю пункт "🛡 Self-Heal" в `AppSidebar` (admin-секція).
- Лінк з `admin.health.tsx` (поточний health monitor) — "Open Self-Heal".
- Toast у `InsightToasts` коли створюється P0/P1 інцидент.

---

## Безпека (Zero-Breakage Rule)
- Кожна auto-apply дія має **revert_payload** (відкат одним кліком).
- Whitelist жорстко зашитий у код — не редагується з UI.
- BLOCK при `regression_risk = HIGH` — нічого не робиться, лише логується.
- Dedupe — повторний інцидент того ж `code+scope` за 1h не створює нову auto-apply дію.
- Kill-switch на всю систему: один toggle вимикає все автоматичне виконання.
- RLS на всіх 3 нових таблицях — тільки super_admin.

---

## Що відразу буде працювати
- Перепланування завислих outreach-повідомлень
- Авто-пауза каналу що масово фейлить
- Reset застряглих агент-ранів
- Kill-switch для агентів-рецидивістів
- Алерти про stale dntrade sync, bounce-spike, depleted balance
- Повний audit log з можливістю revert

## Що залишиться ручним (PROPOSE)
- Зміни тарифів, балансів, прав
- Масові апдейти БД
- Все що чіпає юзерські дані напряму

## Файли (новостворені)
- Міграція БД (3 таблиці + RLS)
- `src/lib/self-heal/engine.ts`
- `src/lib/self-heal/detectors/*.ts` (8 файлів)
- `src/lib/self-heal/actions.ts` (whitelist + executors)
- `src/routes/hooks/agents.self-heal-engine.ts`
- `src/routes/hooks/agents.self-heal-apply.ts`
- `src/routes/hooks/agents.self-heal-revert.ts`
- `src/routes/_authenticated/admin.self-heal.tsx`
- `src/components/admin/SelfHealDashboard.tsx`
- `src/components/admin/SelfHealIncidentsQueue.tsx`
- `src/components/admin/SelfHealActionsLog.tsx`
- Edit: `src/components/layout/AppSidebar.tsx` (+1 пункт меню)

Орієнтовно ~1500 LOC. Це великий, але цільний шматок — за один прохід зроблю кістяк (міграція + engine + 3 ключові детектори + UI), далі додам решту детекторів інкрементально, щоб нічого не зламати.
