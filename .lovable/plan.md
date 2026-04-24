

# План: налагодити підключення зовнішніх БД-програм (DN Trade, Shopify, WooCommerce, Bitrix24, Stripe, Poster, REST, Sheets)

## Що зараз ламається (виявлено в коді/БД)

1. **Wizard двічі ламається на DN Trade**
   - У хабі `/brand/integrations` для DN Trade відкривається **загальний** `IntegrationWizard`, який кличе `/api/integrations/verify/dntrade` → `pullDnTrade()`. Але DN Trade має ВЛАСНИЙ роут `/hooks/integrations/dntrade-verify` з мʼякою логікою (повертає `valid:false` без 4xx). Універсальний роут просто кидає сирі помилки `DN Trade XXX:`.
   - Кнопка «Створити підключення» в універсальному wizard **зберігає ключ ДО перевірки** і не кличе `dntrade-verify` — тобто ключ уже в БД, навіть якщо невірний; sync потім падає мовчки в `last_sync_error`.
   - На дашборді `/brand` `DnTradeIntegrationCard` дублює цю саму інтеграцію. Користувачу здається, що є «два різні DN Trade», і два UI-стани розʼїжджаються.

2. **Verify-роут видає 401 для нових тенантів**
   - `/api/integrations/verify/$provider` робить `userClient.from("tenant_integrations").select(...)` з RLS, але **до того як інтеграція збережена**. Якщо `credentials` не передані (через крок «Перевірити» з порожнім полем), повертає 404 «Інтеграцію не знайдено». Текст помилки в UI виглядає як «не вдалось підключитись».
   - Сам роут не верифікує що користувач — admin саме `tenant_id` (просто `getClaims` + RLS). Для DN Trade-токена з оголошеним admin RLS це працює, але повідомлення про помилку нечитабельне.

3. **Sync-кнопки в `IntegrationManageDialog` падають мовчки**
   - Для не-DN Trade провайдерів кличеться `/api/integrations/sync/$provider`. Якщо конектор кидає 502, toast показує `e.message`, але запис у `import_jobs` НЕ створюється (помилка до `insert`). У результаті в журналі імпортів — порожньо, а власник не розуміє «чому нічого не сталось».

4. **Pending-tenant блокує всі інтеграції**
   - Новий бренд створюється зі статусом `pending`. RLS `tenant_integrations` пускає лише `is_tenant_admin` (через `tenant_memberships`). Membership створюється, тож формально політика проходить — АЛЕ роути типу `/hooks/integrations/dntrade-sync` мовчки працюють і пишуть дані в pending-тенант, що нелогічно. Краще блокувати sync до верифікації і показати чесне повідомлення.

5. **Webhook URL для inbound показується в UI лише після збереження** — користувач не може скопіювати приклад наперед.

6. **Немає UI-фідбеку про мережеві блокування `safeFetch`**
   - Якщо власник вводить Shopify домен типу `localhost:3000` або self-hosted Bitrix у приватній мережі, `safeFetch` кидає «Заборонено: приватні / локальні / metadata-адреси». Це показується сирим текстом — але без підказки «введи публічний домен».

7. **`DnTradeIntegrationCard` показується ВСІМ брендам на `/brand`**
   - Навіть якщо бренд — кавʼярня, що ніколи не використовуватиме DN Trade. Створює шум. Має зʼявлятись **тільки** коли в `tenant_integrations` уже є рядок `provider='dntrade'` АБО користувач явно вибрав це з хабу.

---

## Що зробити

### 1. Уніфікувати DN Trade в одному UX
- В `IntegrationWizard` для `integration.id === "dntrade"`:
  1. Замість `/api/integrations/verify/dntrade` кликати `/hooks/integrations/dntrade-verify`.
  2. Кнопка «Перевірити» обовʼязкова перед «Створити підключення». Якщо `valid:false` → блокуємо збереження.
  3. Після збереження — НЕ показувати «Готово!», а перенаправляти на `/brand/integrations` з відкритим `IntegrationManageDialog` для DN Trade, який має CTA «Запустити перший повний sync».
- На `/brand` (дашборд) рендерити `DnTradeIntegrationCard` тільки якщо `tenant_integrations` має рядок з `provider='dntrade'`.

### 2. Надійний verify
- Дозволити `/api/integrations/verify/$provider` працювати **без** запису в БД, якщо `credentials` передано в body (зараз ця гілка вже є, але впаде на `BodySchema` для DN Trade бо `credentials` повинен бути `string`, а DN Trade key — довгий — ок).
- Для DN Trade окрема гілка `if (provider === 'dntrade')` → виклик `verifyDnTradeKey` без pull.
- Зрозумілі повідомлення українською: «Сервер DN Trade відхилив ключ. Перевірте, що це ApiKey з прав читання.»
- Для Shopify/Woo/Bitrix — підказки «домен має бути публічним https://».

### 3. Гарантоване створення `import_jobs`
- В `/api/integrations/sync/$provider` створювати `import_jobs` **до** `runConnectorPull`, зі `status='running'`, `rows_total=0`. Якщо connector кидає — оновити job `status='failed'`, `error_summary=[{message}]`. Так власник завжди бачить факт спроби в журналі імпортів.

### 4. Блокування для pending-тенантів
- В `/api/integrations/verify`, `/api/integrations/sync`, `/hooks/integrations/dntrade-sync`, `/hooks/integrations/dntrade-verify`: перевіряти `tenants.status`. Якщо `pending` або `rejected` — повертати 403 з повідомленням «Бренд ще не верифіковано супер-адміном».
- В UI `/brand/integrations`: коли `current.status !== 'active'`, показувати банер замість списку інтеграцій («Підключення доступні після верифікації бренду адміністратором»).

### 5. Покращити `IntegrationManageDialog`
- Webhook tab показувати ЗАВЖДИ для inbound-можливих провайдерів (зараз — тільки після генерації). Автоматично генерувати `webhook_secret` при першому відкритті, якщо порожньо.
- Кнопка «Запустити перший імпорт» додатково в overview, окремо від трьох sync-кнопок.

### 6. UX-помилки `safeFetch`
- В `runConnectorPull` обгортати помилки `safeFetch` в локалізований текст: «Цей URL не дозволено (приватна або локальна мережа). Використайте публічний https-домен.»

### 7. Невелике прибирання дашборду
- `DnTradeIntegrationCard` лише коли є рядок інтеграції; інакше — кнопка-плашка «Підключити DN Trade →» що веде у `/brand/integrations`.

---

## Технічні зміни (файли)

- `src/components/integrations/IntegrationWizard.tsx` — спецгілка для `dntrade`, обовʼязковий verify перед save, нормалізація помилок.
- `src/routes/api/integrations.verify.$provider.ts` — гілка для `dntrade` через `verifyDnTradeKey`, перевірка статусу tenant, локалізовані помилки.
- `src/routes/api/integrations.sync.$provider.ts` — створення `import_jobs` до pull, оновлення на failed, перевірка tenant status.
- `src/routes/hooks/integrations.dntrade-sync.ts` + `dntrade-verify.ts` — guard на `tenants.status='active'`.
- `src/routes/_authenticated/brand.tsx` — умовний рендер `DnTradeIntegrationCard` тільки якщо інтеграція реально існує.
- `src/routes/_authenticated/brand.integrations.tsx` — банер про pending tenant; auto-open manage-dialog після збереження.
- `src/components/integrations/IntegrationManageDialog.tsx` — webhook tab з auto-generate, окрема CTA «Перший імпорт».
- `src/lib/integrations/connectors.ts` — обгортка `safeFetch` помилок у людську мову.

## Перевірка після впровадження
1. Створити новий бренд як звичайний користувач → бачимо банер «Очікує верифікації» → інтеграції недоступні.
2. Адмін верифікує → відкриваємо `/brand/integrations` → DN Trade → вводимо невірний ключ → отримуємо «DN Trade відхилив ключ».
3. Вводимо валідний ключ → автоматично відкривається manage-діалог → запускаємо повний sync → в журналі імпортів зʼявляється рядок `running` → потім `completed`.
4. Перевіряємо Shopify з фейковим доменом → отримуємо «домен має бути публічним https://».
5. Webhook (Zapier) — копіюємо URL/secret одразу на кроці 1, без зайвого збереження.

