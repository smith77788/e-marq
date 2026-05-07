## Що будуємо

Дві сторінки для дебагу вхідного трафіку на `/hooks/ingest`:
- `/admin/ingest-logs` — super_admin бачить усіх tenant-ів
- `/brand/ingest-logs` — owner бачить лише свого tenant-а

Гібридне джерело: успішні події з `events`, помилки/відхилені — з нової таблиці `ingest_error_logs`. Без авто-очистки.

## Кроки

### 1. Міграція БД
Створити таблицю `public.ingest_error_logs`:
- `tenant_id` (nullable — бо помилка може бути «unknown tenant»)
- `tenant_slug_attempted` (text, nullable)
- `status_code` (int)
- `error_code` (text — наприклад `unknown_tenant`, `invalid_json`, `event_insert_failed`)
- `error_message` (text)
- `request_body` (jsonb, truncated до ~8KB)
- `request_ip` (text), `user_agent` (text), `origin` (text)
- `event_type_attempted` (text)
- `created_at` (timestamptz default now())

Indexes: `(tenant_id, created_at desc)`, `(created_at desc)`, `(status_code, created_at desc)`.

RLS:
- super_admin → SELECT all
- owner → SELECT тільки `tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())` (або який паттерн уже використовується)
- INSERT тільки service_role

### 2. Інструментація `/hooks/ingest`
У `src/routes/hooks/ingest.ts` додати запис у `ingest_error_logs` для всіх failure-шляхів:
- Invalid JSON (400)
- Unknown / inactive tenant (404) — зберегти `tenant_slug_attempted`
- Event insert failed (500)
- Unknown event_type → НЕ помилка (це fallback на `content_viewed`), але додати `payload.original_type` до events (вже є)

Із request брати IP (`x-forwarded-for`), user-agent, origin. Body truncate до 8KB перед записом.

### 3. Server function для UI
`src/lib/admin/ingestLogs.functions.ts`:
- `getIngestLogs({ tenant_id?, scope: 'admin'|'brand', limit, before_cursor, status_filter: 'all'|'errors'|'success' })`
- Захищена `requireSupabaseAuth`. Перевіряє super_admin (для admin scope) або membership tenant-а (для brand scope).
- Повертає merged feed:
  - errors: select з `ingest_error_logs`
  - success: select з `events` (фільтр по тих, що мають `payload.source = 'pixel'` або через окрему мітку — обговоримо у коді; найпростіше — всі events за останні N годин з обмеженням)
- Сортує по `created_at desc`, пагінація через cursor.

### 4. UI сторінки
`src/routes/_authenticated/admin.ingest-logs.tsx` і `src/routes/_authenticated/brand.ingest-logs.tsx`:
- Фільтри: tenant (тільки в admin), статус (Усі / Помилки / Успіх), event_type, діапазон часу.
- Таблиця: timestamp · status badge (200 зелений, 4xx жовтий, 5xx червоний) · tenant slug · event_type · error_code · короткий preview body.
- Клік по рядку → drawer з повним JSON body, response, headers (IP, UA, origin).
- Auto-refresh кнопка + «остання година» quick filter.
- Лінк зі сторінки в сайдбар: під «Admin» і «Brand → Settings».

### 5. Навігація
- `src/components/layout/AppSidebar.tsx`: додати пункти «Ingest logs» у відповідні секції з гейтами по ролі.

## Технічні деталі

- Логування вставляти через `supabaseAdmin` у hook (bypass RLS).
- Не блокувати відповідь клієнту: `await` запис у logs ОК (важливіше не втратити лог, ніж 5мс затримки), але якщо log-insert падає — лише `console.error`, не змінювати статус відповіді.
- `request_body` зберігати як `jsonb` коли валідний JSON, інакше `{ "_raw": "<string>" }`.
- Truncation: якщо stringify > 8000 chars → `{ "_truncated": true, "preview": <first 8000 chars> }`.
- Для success-feed на UI — використовуємо `events` з останніх 24h з умовою `payload->>'source' = 'pixel'` АБО `session_id LIKE 'sess_%'` (підлаштуємо під поточний tracker).

## Поза скоупом

- Авто-очистка / TTL (за вашим вибором).
- Алерти/нотифікації на сплески помилок (можна додати окремо як signal-агента).
- Експорт у CSV (легко додати пізніше).