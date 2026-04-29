
# MARQ v1.0 Transition Plan

3 фази, послідовні. Старий ROADMAP_2026Q2.md (sprint 13 customer page, sprint 16 PL локалізація) **перепишемо** після фази 2 — він був написаний до того, як ти артикулював v1.0 vision.

---

## Фаза 1 — Security Lockdown (~7 год, blocking)

Інвестору не показуємо, поки 4 ERROR не закриті. Telegram bot token уже спалений у scan-результаті.

### 1.1 Ротація компрометованих секретів (~30хв)
- **Telegram bot token** — згенерувати новий через @BotFather, оновити в connector. Старий уже у scan output (а scan video може потрапити куди завгодно).
- **CRON_SECRET** — нова змінна, додам через `add_secret` після твого approve.

### 1.2 Cron auth fix — `cron_anon_key_auth` (E1, ~1.5год)
Файли: `src/lib/acos/cronAuth.ts`, `src/lib/acos/agentRuntime.ts:42`, `src/routes/hooks/agents.self-heal-engine.ts:62`.
- Замінити `token === SUPABASE_PUBLISHABLE_KEY` на `token === CRON_SECRET`.
- 24-годинний fallback з warning у logs (щоб pg_cron jobs не зламались миттєво — їх ~80+ і всі шлють anon key).
- Міграція UPDATE по `cron.job` записах: замінити `apikey` header на `Authorization: Bearer <CRON_SECRET>`.
- Через 24 год — видалити fallback окремою міграцією.

### 1.3 tenant_configs RLS — `tenant_configs_telegram_token_exposed` (E3, ~2год)
Зараз `USING(true)` віддає anon юзеру `bot.token` і `owner_telegram_chat_id`. Найбільший leak.
- Міграція: створити view `tenant_configs_public` з безпечними полями (`tenant_id, brand_name, ui, features, seo`) + `WITH (security_invoker=on)`.
- Поміняти SELECT policy на base table: `USING (is_tenant_admin(tenant_id))`.
- `rg "from\\(.tenant_configs.\\)"` — знайти всі use sites у storefront (`src/lib/storefront/`, `src/lib/site-builder/brandContext.ts`, `src/routes/s.*`) і переключити на view.
- Адмін-сторінки залишаються на base table (читають як admin → проходять RLS).

### 1.4 Telegram owner bind — `tg_owner_hijack` (E2, ~1.5год)
- Видалити unauthenticated `/start owner <slug>` handler у `src/routes/hooks/telegram.poll.ts:207-231`. **Без fallback** — це активна діра.
- Додати в `tenant_configs` колонку `owner_bind_code` (text, nullable) + `owner_bind_expires_at` (timestamptz).
- В `OwnerTelegramBindCard` — кнопка "Generate code" (TanStack server fn з `requireSupabaseAuth` + `is_tenant_admin` check), показує 6-значний код, expiry 10хв.
- Бот приймає `/bind <code>`, шукає тенант з валідним кодом, прописує `owner_telegram_chat_id`, чистить код.

### 1.5 Realtime RLS — `realtime_messages_no_authorization` (E4, ~45хв)
- `rg "supabase.channel\\(" src/` — подивитись як зараз названо топіки. Якщо НЕ `tenant:<id>:*`, спочатку перейменувати.
- Міграція: policy на `realtime.messages` з перевіркою `tenant_memberships`.

### 1.6 Гігієна (~30хв)
- `.gitignore` — додати явно `.env` (зараз тільки `*.local`).
- `SUPA_extension_in_public` — перенести extension у `extensions` schema через міграцію.
- `SUPA_rls_policy_always_true` — знайти write-policies з `USING(true)`, лінтер дасть конкретику.

### 1.7 Закриття findings + memory (~15хв)
- `mark_as_fixed` для всіх 4 ERROR + 2 WARN з explanation.
- `update_memory` — оновити security posture (що тепер інтенційно публічне через view, що ні).
- Re-scan для верифікації.

**Файли змін:** ~6 нових міграцій, 4 файли коду, 1 компонент, +1 server fn.
**Ризики:** cron може зламатись на час deploy — мітигація: 24h fallback. Storefront може зламатись після view-switch — мітигація: rg покриє всі use sites.

---

## Фаза 2 — Reality Audit (1 робочий день)

Перш ніж написати реальний v1.0 roadmap, треба знати **що насправді живе**, а не що декларовано в коді. Без цього risk зрізати агентів, які роблять revenue, або зберегти duplicate-код.

### 2.1 Agent activity matrix
SQL по `acos_agent_runs` за останні 30 днів:
- Який agent_id скільки разів запускався
- success_rate
- скільки insights реально породив (`ai_insights` join)
- скільки з тих insights дійшло до `applied`
- скільки з applied дало measurable outcome (якщо `actual_result` поле непорожнє)

Класифікую кожен з ~105 агентів:
- **PROD** — є insights + applied + outcome
- **NOISE** — багато runs, нуль applied
- **DEAD** — runs=0 за 30 днів
- **DUPLICATE** — той самий insight_type що інший агент

### 2.2 Table usage matrix
Для кожної з 98 таблиць:
- Чи є код, що в неї пише (`rg "from\\('table'\\).insert\\|update\\|upsert"`)
- Чи є код, що з неї читає
- К-сть рядків за останні 30 днів (приріст)
- Зв'язки (FK)

Класифікую:
- **CORE** (commerce/customers/events) — лишаємо
- **REFACTOR** (ai_insights, ai_actions, ai_memory) — переробляємо
- **DUPLICATE** (segmentation × 3, churn × 2) — зливаємо
- **DEAD** — видаляємо

### 2.3 Loop closure check
Конкретно для 5 use-cases (price_optimization, churn_risk, stockout_predicted, abandoned cart, winback):
- Чи insight реально породжує action?
- Чи action реально виконується (для price — чи `products.price_cents` справді змінюється; для email — чи `outbound_messages` стає `sent`)?
- Чи outcome пишеться кудись для learning?
- Чи `ai_memory` справді читається наступним run? (Підозра з `mem://core` — НЕ читається.)

### 2.4 Deliverable
Файл `.lovable/AUDIT_2026Q2.md` з:
- agent matrix (CSV-таблиця)
- table matrix
- loop status per use-case
- список агентів на 🪓
- список таблиць на злиття/видалення
- **новий** ROADMAP_2026Q2.md, де sprint 13-16 заміняються на 4 етапи v1.0 (Signals → Decisions → Execution → Learning)

### 2.5 Update memory
- Оновити `mem://core` (прибрати застарілі assumption-и)
- Створити `mem://architecture/v1-target` з новою цільовою архітектурою
- Створити `mem://architecture/audit-2026-04` з ключовими висновками

---

## Фаза 3 — Етап 1.1: Signal Layer Foundation (~3-5 год)

Після аудиту, перший конкретний крок до v1.0. Безпечний — нічого не ламає, лише додає.

### 3.1 Signal tables (materialized views)
3 базові view (можна стартувати з MV, refresh через cron):
- **`product_metrics_14d`** — per (tenant_id, product_id): views, add_to_cart, purchases, conversion_rate, revenue_cents, units_sold, last_purchase_at
- **`customer_metrics_30d`** — per (tenant_id, customer_id): orders_count, total_spent_cents, last_order_at, days_since_last_order, channel_responsiveness
- **`funnel_metrics_14d`** — per tenant_id, day: visits → cart → checkout → paid + drop-off rates

### 3.2 Refresh cron
- TanStack route `src/routes/api/public/hooks/signals.refresh.ts`
- pg_cron щогодини: викликає route → `REFRESH MATERIALIZED VIEW CONCURRENTLY`
- Auth: новий CRON_SECRET (з фази 1)

### 3.3 Один pilot agent перевести на signals
Вибрати найпростіший (напр. `aov_leak_detector`):
- Зараз сам рахує метрики SQL-ями
- Переключити на `select * from product_metrics_14d where conversion_rate < 0.02`
- Бенчмарк: latency runs до/після, точність insights до/після
- Якщо ОК — це template для решти агентів у наступних спринтах

### 3.4 Backfill memory
- `mem://architecture/signal-layer` — конвенції, як додавати нові signals, як cron оновлює, як агент їх читає

---

## Що НЕ робимо

- Не пишу детальний план фаз 4-6 (Decision Layer, Execution, Learning) зараз. Після аудиту може виявитись, що щось вже частково є, або щось вимагає іншої послідовності. Пишу окремим планом коли дойдемо.
- Не торкаємось frontend / Customer page / PL локалізації. Старий sprint 13/16 з ROADMAP — викидаємо.
- Не рубаємо агентів у фазі 1-3. Рубати — після audit + після того, як signal layer довів правоту хоча б на 1 пілоті.

---

## Estimate

- Фаза 1: 7 год чистих, ~1 робочий день з тестуванням після Publish
- Фаза 2: 1 робочий день (паралельно мені readonly + тобі для верифікації висновків)
- Фаза 3: 3-5 год

**Approve — стартую з Фази 1.1 (rotate Telegram token + add CRON_SECRET).**
