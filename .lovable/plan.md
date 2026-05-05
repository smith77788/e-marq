# План: 3 паралельні треки за пріоритетом P0

Користувач сказав "дій на свій розсуд" — беру **три найкритичніші пункти з аудиту 2026-Q2**, які блокують і безпеку, і надійність, і масштабування. Решта (Shopify, /account, bootstrap flow) — окремими спринтами після цього.

---

## Трек A — Sprint 12: Security audit (~30 хв)

**Проблема**: `.env` у git (ризик due-diligence), no audit log of who triggered which decision.

**Зробити**:
1. Перевірити що `.env` має правильні permissions і що в ньому **тільки** publishable keys (а не service_role). Якщо є service_role → негайна ротація через Lovable Cloud Secrets UI.
2. Додати `.env` у `.gitignore` (якщо ще нема). Файл лишиться у working tree, але не буде коммітитись далі.
3. Створити `audit_log` таблицю + тригери на критичні дії:
   - `decisions` (approve/reject/execute)
   - `tenant_memberships` (role changes)
   - `tenant_integrations` (credentials updates)
   - Колонки: `actor_user_id`, `tenant_id`, `entity_type`, `entity_id`, `action`, `before`, `after`, `created_at`, `ip_hash`
4. RLS: super_admin читає все, brand owner читає свій тенант, інші — заборона.
5. UI `/admin/audit-log` зі stream-фільтрами (tenant, actor, entity_type, дата).

**Результат**: GDPR-ready compliance, видно "хто що клікнув".

---

## Трек B — Sprint 15: Test foundation (~2 год)

**Проблема**: 50K+ LOC, нуль тестів. Кожна зміна — російська рулетка. Я сам коли роблю зміни, не маю чим перевірити що executor / measurement loop / dedup-key не зламалися.

**Зробити (мінімальний viable набір, не coverage, а safety net)**:
1. Встановити `vitest` + `@vitest/ui` + `@testing-library/react` + `@testing-library/user-event`.
2. `vitest.config.ts` з jsdom + path aliases синхрон з `vite.config.ts`.
3. `src/test-setup.ts` з global mocks для `supabase` client.
4. Smoke tests на critical paths:
   - `src/lib/acos/cronAuth.test.ts` — перевірка що CRON_SECRET enforced, anon-fallback закритий
   - `src/lib/self-heal/engine.test.ts` — dedup ≤24h працює
   - `src/lib/acos/agentRuntime.test.ts` — `authorizeAgentRequest` правильно reject невалідні токени
   - `src/lib/storefront/cartContext.test.tsx` — додавання/видалення товарів
5. SQL-pure тести через `psql` runner для критичних RPC:
   - `convert_insights_to_decisions` — semantic_key dedup
   - `auto_approve_eligible_decisions` — bootstrap-cap=3 і history mode
   - `measure_pending_outcomes` — 24h gating
6. CI hook (через `package.json` scripts): `bun test` блокує дефолтний flow.

**Результат**: ~15 тестів, які ловлять 80% регресій, які ми вже мали (cron 401, executor whitelist, dedup, measurement gating).

---

## Трек C — Cron revival audit (~20 хв)

**Проблема**: 64/74 hooks-агентів зомбі з 2026-04-21. Fix у коді, але треба верифікувати **який саме fix лишився не-Published** і чи всі cron jobs мають правильний CRON_SECRET header (не anon-key fallback).

**Зробити**:
1. SQL-аудит: `SELECT * FROM admin_list_cron_jobs()` — порахувати скільки jobs ще використовують `apikey` header замість `Authorization: Bearer`.
2. SQL-міграція: для всіх jobs з legacy header → `admin_set_cron_job_command()` із новою командою (Bearer CRON_SECRET).
3. Перевірити `net._http_response` за останню годину після deploy — мають зникнути 401.
4. Створити dashboard widget `/admin/health` → "Cron auth health": % jobs зі status_code=200 за 1h, 24h. Алерт якщо <90%.
5. Якщо знайду в коді hook-routes які ще не fan-out по тенантах — fix і документувати у memory.

**Результат**: 64 зомбі-агенти прокидаються, `/agents/library` перестає брехати.

---

## Технічні деталі

### Audit log тригер (приклад)
```sql
CREATE TABLE public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID,
  tenant_id UUID,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- + has_role-based policies + trigger function
```

### Vitest config (приклад)
```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

### Cron header migration (приклад)
```sql
SELECT admin_set_cron_job_command(
  'agent-tick-1min',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  )$$
);
```

---

## Порядок виконання (одна сесія)

1. **C спочатку** (cron revival) — найшвидший win, прокидає 64 агенти, не блокує нічого.
2. **A** (security/audit log) — критично для онбордингу інвесторів, малий код-обсяг.
3. **B** (tests) — найдовший трек, але роблю в кінці бо інші зміни мають вже бути готові щоб їх покрити.

Після цього у наступних сесіях: Shopify connector → /account → weekly digest → bootstrap flow.

## Файли (estimate)

**Створити** (~12):
- `supabase/migrations/*_audit_log.sql`
- `src/routes/_authenticated/admin.audit-log.tsx`
- `vitest.config.ts`, `src/test-setup.ts`
- `src/lib/acos/cronAuth.test.ts`, `src/lib/self-heal/engine.test.ts`, `src/lib/acos/agentRuntime.test.ts`
- `src/lib/storefront/cartContext.test.tsx`
- `src/components/admin/CronHealthWidget.tsx`

**Редагувати** (~5):
- `package.json` (vitest deps + scripts)
- `.gitignore` (.env entry якщо нема)
- `src/components/layout/AppSidebar.tsx` (link на audit log)
- `src/lib/i18n.ts` (нові keys)
- `src/routes/_authenticated/admin.health.tsx` (вбудувати CronHealthWidget)
