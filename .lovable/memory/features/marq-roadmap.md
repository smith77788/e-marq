---
name: MARQ Implementation Roadmap
description: 6-sprint план для перетворення MARQ з аналітики на повноцінну комерційну платформу. Pilot = BASIC.FOOD.
type: feature
---

# MARQ Implementation Roadmap

**Pilot tenant:** BASIC.FOOD (натуральні ласощі для собак і котів, UA)

## Правила без винятків
- Кожен рядок коду слідує існуючим патернам
- Не переписуєш робочий код — лише розширюєш
- TypeScript strict, нуль `any`
- Кожна DB зміна = нова міграція (НЕ редагувати існуючі)
- Весь UI текст через `useT()` / `tStatic()`

## Існуючі утиліти (використовувати, не переписувати)
- `src/lib/acos/agentRuntime.ts` — authorizeAgentRequest, startAgentRun, finishAgentRun, failAgentRun, insertInsightsDedup
- `src/lib/money.ts` — formatMoney(cents), formatMoneyCompact(cents)
- `src/lib/i18n.ts` — useT(), tStatic()
- `src/lib/cart.ts` — loadCart, saveCart, clearCart
- `src/integrations/supabase/client.ts` — supabase (anon, client)
- `src/integrations/supabase/client.server.ts` — supabaseAdmin (server only)
- `src/hooks/useAuth.tsx`, `src/hooks/useTenantContext.tsx`

## Sprints

### Sprint 1 — DB Foundation ✅ (частково зроблено)
- product_catalog_v2.sql: product_variants, product_images, collections, collection_products
- ALTER products: compare_at_price_cents, url_handle, tags, weight_grams, seo_title/description, has_variants
- ALTER orders: shipping_address, shipping_method, shipping_cost_cents, payment_method, payment_ref, tracking_number/url, paid_at, fulfilled_at, notes
- email_engine.sql: email_sends, email_campaigns, email_events, email_suppressions
- loyalty_program.sql: loyalty_programs, loyalty_accounts, loyalty_transactions
- Storage bucket `product-images`
- RPC: validate_discount_code, get_storefront_products_v2

### Sprint 2 — Storefront ✅ (частково)
- s.$slug._layout / index / products.$productId / search / collections / checkout
- ShippingSelector + Nova Poshta API proxy (np-cities, np-warehouses)

### Sprint 3 — Admin Catalog ✅ (частково)
- brand.products, brand.products.$productId (tabs), brand.orders, brand.catalog
- AppSidebar нав, Tabs у brand.tsx

### Sprint 4 — Email + Payments ✅ (готово)
- Resend gateway, templates, webhooks, suppression, unsubscribe ✅
- EmailDomainCard, EmailCampaignsCard ✅
- TenantConfigForm: розширено payments секцію (manual + LiqPay + WayForPay + Monobank) ✅

### Sprint 7 — UA Payment Gateways ✅ (готово)
- DB: payment_intents, payment_callbacks_log, RPC create_payment_intent / mark_payment_failed / mark_order_paid_by_gateway ✅
- Server libs: `liqpay.server.ts` (SHA1), `wayforpay.server.ts` (HMAC-MD5), `monobank.server.ts` (Invoice API) ✅
- Public routes: `/api/public/payments/{liqpay,wayforpay,monobank}-{init,callback}` ✅
- Admin UI: поля Public/Private/Token для всіх 3 шлюзів у TenantConfigForm ✅
- Storefront UI: динамічний RadioGroup на checkout, redirect через `startGatewayPayment` ✅
- Спільна типізація `PaymentMethod` (manual | liqpay | wayforpay | monobank) ✅

### Sprint 5 — Promotions + Loyalty ✅ (готово)
- brand.promotions: повний CRUD промокодів (percent_off / fixed_off / free_shipping)
- validate_discount_code інтегровано в checkout
- LoyaltyCard.tsx (admin: pts/100uah, uah/pt, min_redeem, on/off, stats)
- validate_loyalty_redeem RPC + award_loyalty_points_on_paid trigger
- place_storefront_order розширено _loyalty_redeem_points + _promo_code
- Checkout: блок «Бали лояльності» (баланс, списання, projection earn)

### Sprint 6 — New Agents ✅ (готово)
- agents.email-abandoned-cart ✅
- agents.email-winback (auto-generated WINBACK-XXXXXX promo) ✅
- agents.email-post-purchase (review request +6–8d) ✅
- agents.order-status-notifier (safety-net cron) ✅
- agents.restock-notifier ✅
- Storefront: блок "Повідомити, коли з'явиться" на сторінці товару (public RPC `subscribe_restock_notification`) ✅
- Усі 5 агентів зареєстровані в agents.run-all.ts ✅

### Sprint 8 — Email UX consolidation ✅ (готово)
- Окрема сторінка `/brand/email` з 3 табами: Кампанії / Автоматизації / Налаштування ✅
- Новий `EmailAutomationsCard` — 5 toggle для email-сценаріїв; стан у `tenant_configs.features.email_automations.{key}` ✅
- `EmailCampaignsCard` перенесено з `/brand/promotions` → `/brand/email#campaigns` ✅
- `EmailDomainCard` перенесено з `/brand/integrations` → `/brand/email#settings` ✅
- Sidebar → новий пункт «Email» (sb.email) у групі «Магазин» ✅
- i18n: 18 нових ключів (UA + EN) для табів і автоматизацій ✅

### Sprint 9 — Email automation flags wiring ✅ (готово)
- Новий helper `src/lib/acos/emailAutomationFlags.ts` — `isEmailAutomationEnabled(tenantId, key)` ✅
- Усі 5 email-агентів роблять early-return з `reason: "disabled_by_owner"` коли власник вимкнув toggle: ✅
  - `agents.email-abandoned-cart` → `abandoned_cart`
  - `agents.email-winback` → `winback`
  - `agents.email-post-purchase` → `post_purchase`
  - `agents.order-status-notifier` → `order_status`
  - `agents.restock-notifier` → `restock`
- Default = ON (відсутність ключа трактується як увімкнено), щоб існуючі тенанти не зламалися ✅
- `tsc --noEmit` чистий ✅

### Sprint 10 — Bulk Promo Generator + Source-of-truth ✅ (готово)
- `.lovable/MARQ_PROMPT_V2.md` зафіксовано як джерело істини ✅
- Memory оновлено (`mem://features/marq-prompt-v2`) ✅
- `BulkPromoGeneratorDialog.tsx` — генерація 1–500 кодів (percent_off / fixed_off / free_shipping), кастомний префікс, безконфліктна вибірка, CSV-експорт ✅
- Інтегровано в `/brand/promotions` (кнопка «Bulk generate») ✅
- 14 нових i18n ключів `bpr.bulk.*` (UA + EN) ✅

### Sprint 11 — White-label Site Builder ✅ (готово)
**Мета:** дати бренду згенерувати власний публічний сайт на основі шаблону **My Food Diary** (project ID `a74eaa2d-62ac-4a30-98d6-1c37f45f6f79`, https://basicfood.lovable.app) — повна функціональна копія під його бренд, видана у вигляді ZIP-архіву з готовим до деплою кодом.

**Етап 11.1 — Реєстр шаблонів і брендингу (DB)**
- Нова міграція `site_builder.sql`:
  - `site_templates` (id, key="mfd", name, description, source_repo, source_commit, default_locale, is_active, preview_url, capabilities jsonb)
  - `site_brand_profiles` (tenant_id, template_id, brand_name, tagline, description, logo_url, favicon_url, primary_color, accent_color, font_family, contact_email, contact_phone, social_links jsonb, custom_domain, locale, currency, legal_entity, address, updated_at) — UNIQUE(tenant_id, template_id)
  - `site_builds` (id, tenant_id, template_id, status='queued|building|ready|failed', archive_url, archive_size_bytes, archive_sha256, manifest jsonb, error, requested_by, started_at, finished_at) — INDEX(tenant_id, created_at DESC)
- RLS: тенант бачить тільки свої `site_brand_profiles` + `site_builds`; `site_templates` — read-only public
- Storage bucket `site-builds` (private, signed URL ~24h)

**Етап 11.2 — Snapshot шаблону MFD**
- Server-only задача `hooks/site-builder.snapshot-mfd.ts`:
  - Читає файли через `cross_project--read_project_file` (whitelist: src/**, public/**, package.json, vite.config.ts, tailwind.config.ts, index.html, supabase/migrations/**, README)
  - Виключає: .env, supabase/.temp, node_modules, lockfiles, .lovable/**, *.log
  - Зберігає манifest у `site_templates.capabilities.snapshot` + сирі файли в bucket `site-template-snapshots/mfd/<commit>/`
- Запускається вручну адміністратором (не клієнтом)

**Етап 11.3 — Підготовка контексту бренду**
- `src/lib/site-builder/brandContext.ts`:
  - `loadBrandProfile(tenantId, templateId)` — мердж `site_brand_profiles` + `tenant_configs` (logo, brand_name, seo, payment keys → only public ones)
  - `validateBrandProfile()` — перевірка обов'язкових полів (brand_name, primary_color, contact_email)
  - НЕ копіюємо приватні ключі (Resend, LiqPay private, Monobank token, MARQ_WEBHOOK_SECRET)

**Етап 11.4 — UI: майстер у брендовому кабінеті**
- Нова сторінка `/brand/site-builder`:
  - Вкладка «Profile»: форма з усіма полями `site_brand_profiles` + preview логотипу/палітри
  - Вкладка «Theme»: 5 пресетів кольорів (oklch tokens), live-preview карти/кнопки
  - Вкладка «Content»: hero copy, about-us, food categories defaults (food_categories_seed), legal pages
  - Вкладка «Builds»: список останніх 10 білдів зі статусом, sha256, кнопкою «Скачати ZIP» (signed URL)
  - Кнопка «Згенерувати сайт» → POST на server function (нижче)
- Sidebar: пункт «Site Builder» (sb.site_builder) у групі «Магазин»

**Етап 11.5 — Білд-пайплайн (server function)**
- `src/routes/api/site-builder.build.ts` (POST, auth required):
  1. Перевірити права (owner / admin тенанта)
  2. Валідувати `site_brand_profiles` запис
  3. Створити `site_builds` row зі статусом `building`
  4. Викликати `hooks/site-builder.run.ts` через fetch на `/hooks/site-builder/run` із `tenant_id` + `build_id`
  5. Повернути `build_id` (фронт polling кожні 3с)

- `src/routes/hooks/site-builder.run.ts` (server-only, secret-protected):
  1. Завантажити snapshot шаблону з bucket
  2. Прогнати through `applyBrandTransforms`:
     - Замінити логотип, favicon, OG-image
     - Підставити бренд-кольори в `src/index.css` (oklch tokens)
     - Замінити SEO meta в `index.html` + всіх routes
     - Згенерувати `.env.example` з placeholder-ами для Supabase URL/anon (НЕ власні ключі MARQ)
     - Додати `BRAND_README.md` з інструкцією деплою
  3. Створити ZIP через `JSZip` (Worker-сумісний) — структура: `<brand-slug>-site/...`
  4. Залити в storage `site-builds/<tenant_id>/<build_id>.zip`
  5. Оновити `site_builds` (status='ready', archive_url, sha256, size)
  6. На failure → status='failed', error=stack

**Етап 11.6 — Безпека**
- ZIP НЕ містить: `MARQ_WEBHOOK_SECRET`, Resend API key, LiqPay private key, Monobank token, service-role keys, `.lovable/**`
- Public anon Supabase URL/key → у `.env.example` як plaintext placeholder з коментарем «створіть свій проект»
- Власник бренду генерує не частіше ніж раз на 5 хв (rate limit у server function)
- ZIP signed URL живе 24h, після цього потрібно перегенерувати посилання

**Етап 11.7 — Тести й перевірка ✅**
- `tsc --noEmit` чистий ✅
- JSZip Worker-сумісний (smoke-test проходить) ✅
- Bucket `site-builds` приватний, signed URL 24h ✅
- Шаблон `mfd` зареєстровано (source_project_id `a74eaa2d-…`) ✅
- Жоден секрет не потрапляє в архів — grep підтверджує лише плейсхолдери в `.env.example` ✅
- Membership re-check через RPC `is_tenant_member` (defence-in-depth) ✅
- Cooldown 60s блокує дабл-кліки (для прод rate-limit чекає інфраструктуру) ✅
- i18n: усі нові тексти через `useT()` (UA + EN) ✅

**Етап 11.8 — Richer overlay ✅**
- Повний `src/index.css` (HSL tokens, dark/light, утиліти, a11y) з підставленими брендовими `--primary`/`--accent`/`--ring` ✅
- `REMIX_GUIDE.md` — 10 кроків від remix до publish, із врахуванням custom_domain ✅
- `seed.json` — машино-читний контент (hero / about / contacts / theme / categories) для one-shot вставки через Lovable chat ✅
- ZIP-структура: `src/index.css`, `public/manifest.webmanifest`, `index.html`, `package.json`, `.env.example`, `assets/README.md` — drop-in у remix MFD ✅
- file_count = 12, manifest.json оновлено ✅
- TS чистий, smoke-test ZIP проходить, секретів немає ✅

**Залежності з MFD-проекту:**
- Шаблон витягуємо з `cross_project` API під час snapshot-етапу
- За кожним relevant апдейтом MFD адмін MARQ запускає re-snapshot → версія в `site_templates.source_commit`

### Sprint 12 — Inline превʼю контенту в адмінці ✅ (готово)
- Усі посилання, які раніше відкривали `/m/<slug>` в новій вкладці lovable, тепер відкривають **MagnetPreviewDialog** (модал) одразу в адмінці.
- Спільна утиліта `src/lib/markdown.ts` (renderMarkdown + escapeHtml) для inline-показу. `m.$slug.tsx` теж її використовує.
- У модалі: повний body, мета-опис, теги, статистика views/signups, кнопка «Відкрити публічну сторінку» для шерингу.
- **Правило для майбутніх фіч:** усі внутрішні артефакти (магніти, content_pages, drafts, insights body) показувати inline через Dialog/Drawer, а не через переходи на окремі публічні сторінки. Публічні `/m/`, `/s/` лишаються тільки для зовнішніх читачів.

## Абсолютні заборони
- НЕ редагувати існуючі міграції
- НЕ міняти agentRuntime.ts
- НЕ вводити нові UI бібліотеки (тільки @radix-ui / shadcn/ui)
- НЕ хардкодити tenant_id чи URL
- НЕ використовувати supabaseAdmin на клієнті
- НЕ виставляти платіжні ключі клієнту (лише server functions)
- НЕ ламати Telegram flow
- НЕ видаляти DN Trade інтеграцію

## Чекліст готовності модуля
- [ ] Migration застосована
- [ ] `tsc --noEmit` чистий
- [ ] Server functions з try/catch
- [ ] Всі queries з `eq("tenant_id", tenantId)`
- [ ] UI через `useT()`, нуль hardcoded UA текстів
- [ ] Mobile (375px)
- [ ] Loading через Skeleton
- [ ] Errors через sonner toast
- [ ] Нові агенти видно в AcosAgentRuns

### Sprint 13 — Human-friendly agent toasts ✅
- `src/lib/outreach/agentSummary.ts`: friendlyAgentSummary / friendlyAgentError / agentLabel
- Toast більше не показує сирий JSON `{"<tenantId>":{"skipped":"instagram_inactive"}}`
- Замість `instagram_inactive` користувач бачить "Instagram вимкнено в налаштуваннях outreach"
- Зведена статистика по N проєктах + людський plural ("3 нових записи у 2 проєктах")
- Підказки (hint) автоматично додаються до toast (наприклад про відсутність INSTAGRAM_RSS_URL)
- Застосовано в Lead Radar (admin.lead-radar.tsx) та Outreach Hunter (OutreachHunterTabs.tsx)

### Sprint 14 — Brand-aware lead agents ✅
- `src/lib/lead/brandContext.ts`: getAllTenantBrandContexts() + getTenantBrandContext()
- Авто-синтез `bootstrap_facts.brand_profile` з products/seo/content_pages, якщо профілю ще немає
- Web Prospector тепер генерує DuckDuckGo-запити з категорій і ключових слів КОЖНОГО тенанта (не hardcoded UA-нішами)
- Social Engager пише outreach від імені бренда-джерела з тоном (editorial/conversational/minimal)
- Content Magnet створює власний пакет SEO-магнітів під кожен бренд (категорії + фірмовий кейс), slug префіксований brand-slug
- prospect.signals.discovered_for_tenant зберігає, який бренд знайшов prospect → social-engager пише саме від його імені
- Toasts розширені: per_brand розподіл і "Опрацьовано N брендів"
- Агенти працюють з першого дня без ручної настройки — bootstrap-дані синтезуються автоматично

### Sprint 15 — Inline довідка замість зовнішніх посилань ✅
- Новий `src/components/layout/HandbookSheet.tsx` — повноцінний Sheet з 6 табами (Швидкий старт, Власник, Адмін, Агенти, Інтеграції, FAQ), всі дані з тих самих i18n ключів, що й `/handbook`
- Кнопка «Посібник» у sidebar більше не веде на окрему сторінку — відкриває inline-Sheet прямо в кабінеті
- Опціональна кнопка «Відкрити повний посібник» залишилася для тих, хто хоче поділитись посиланням
- i18n: новий ключ `hb.openFullPage` (UA + EN)
- Маркетингова сторінка `/handbook` залишається для зовнішніх відвідувачів і SEO

### Sprint 16 — Mobile polish + Lead Radar UA-локалізація ✅
- Lead Radar повністю українською: статуси (знайдені/відібрані/у роботі/стали клієнтами/відхилені/не вдалось зв'язатись), кнопки агентів («Знайти бренди в інтернеті», «Підготувати листи», «Згенерувати SEO-сторінки»), таби («Звернення», «Глибокий пошук»), per-row actions («Написати»/«Відібрати»), бейдж "відповідність N" замість "fit N"
- Кнопки агентів стали full-width на мобільному, з власним per-button loader (раніше всі три блимали разом)
- Header кабінету (`_authenticated.tsx`) адаптовано під 394px:
  - Breadcrumbs ховаються до `md:`
  - LiveStatus pulse — від `sm:` (на дрібному він зайвий)
  - Super-admin badge на mobile показує лише ★ (без тексту)
  - LanguageSwitcher ховається на mobile (тримаємо ThemeToggle + Notifications + Sign-out стрілка)
  - Sign-out на mobile = «↩» з aria-label
  - Зменшено гепи `gap-2 sm:gap-3` + padding `px-2 sm:px-4`
- ProspectRow stack на mobile (flex-col) → action-кнопки переходять на новий рядок, не вилазять

### Sprint 17 — Code hygiene pass ✅
- `prettier --write src/**` пройшов: відформатовано outreach-reddit-hunter, outreach-roi-collector, тощо
- Виправлено 5 lint-помилок:
  - `src/components/ui/input-otp.tsx` — прибрано `as any`, додано типізацію `OTPInputContext.slots`
  - `src/routes/hooks/agents.outreach-instagram-hunter.ts` — sparse arrays `[, ""]` замінено на `?.[1] ?? ""`
- TypeScript `tsc --noEmit` чистий (0 errors)
- ESLint 0 errors (15 warnings — shadcn-ui fast-refresh, не критично)
- Supabase linter: 2 WARN (extension in public + public bucket listing — не нові)
- Console + network: жодних 4xx/5xx, жодних client-side runtime errors

### Sprint 18 — Власний Telegram-бот для Lead Radar / Outreach Hunter ✅
- Новий API: `GET/POST /api/telegram/status` — getMe через connector gateway + керування `outreach_settings.active_channels.{telegram,instagram}`
- Новий компонент `src/components/owner/TelegramConnectCard.tsx` — статус бота (@username), Switch для увімкнення Telegram-агентів, опціонально й Instagram
- Інтегровано в Lead Radar (`/admin/lead-radar`) — картка під header
- Якщо connector ще не підключено → інструкція @BotFather + кнопка «Підключити Telegram»
- Усе залишається в межах кабінету: відповіді надсилаються через `sendTelegramText` без переходу в зовнішні панелі

### Sprint 19 — TelegramConnectCard polish + integrations link fix ✅
- Виправлено битий маршрут «Підключити Telegram»: було `/integrations` (404) → стало `/brand/integrations`
- Прибрано конфлікт `Button asChild + onClick` (toast блокував focus-handling клонованого `<a>`); тепер чистий navigation
- TS `tsc --noEmit` 0 errors, ESLint 0 errors на нових файлах
- Переконались що TelegramConnectCard коректно ховається/розгортається на 394px (Switch + checkbox у колонку, кнопка full-width)


## Backlog

### Sprint 20 (planned) — Керування від імені особистого Telegram-акаунта (не бота)
**Мета:** дати власнику можливість виконувати дії в Lead Radar / Outreach Hunter не від імені бренд-бота, а від його власного особистого Telegram-профілю — як вручну з кабінету, так і автоматизовано агентами на їх розсуд.

**Що має вміти агент від імені користувача:**
- Залишати коментарі під постами в публічних каналах і чатах (де є ком'юніті)
- Писати в особисті повідомлення цільовим користувачам / адмінам каналів
- Ставити позитивні / негативні реакції (👍 ❤️ 🔥 / 👎 💩) на повідомлення в каналах
- Підписуватися/відписуватися на канали в межах outreach-плану
- Читати канали з telegram_channels (вже частково є через RSS, але user-account дає повний доступ без bot-обмежень)

**Архітектурні рішення (фіксуємо для майбутньої реалізації):**
- **MTProto клієнт, не Bot API.** Bot API не дає коментувати, ставити реакції чи писати незнайомим. Потрібен user-mode (gramjs / telethon-style). Через Worker SSR прямо неможливо (нема довгих TCP-сесій) — тому окремий runner поза Worker (Node host або self-hosted runner з cron pull-job).
- **Авторизація:** UI кабінету веде через Login flow (phone → 2FA code → password). Зберігаємо StringSession **зашифровано** в `tenant_secrets.telegram_user_session` (новий стовпчик або JSONB у `tenant_configs.bot.telegram_user`). Шифрування — Supabase Vault або власний AES-GCM з MARQ_WEBHOOK_SECRET-похідним ключем.
- **Per-tenant ізоляція:** одна сесія на тенанта. Owner може в будь-який момент Logout (revoke + clear session).
- **Quota & safety:** rate-limit (≤30 коментарів/добу, ≤10 DM/добу, ≤50 реакцій/добу) — Telegram банить за спам. Toggle в `outreach_settings.user_account.{commenting_enabled,dm_enabled,reactions_enabled}`. Default = OFF.
- **Risk levels** для агентського вибору (re-use `agent_permissions.auto_apply_max_risk`):
  - `low` = реакція 👍 на пост, де lead вже згадав бренд
  - `medium` = коментар у відкритому чаті
  - `high` = DM незнайомому → завжди manual approve
- **UI:** новий `TelegramUserAccountCard.tsx` поряд із `TelegramConnectCard` (бот) — окремі сутності, не плутати. Власник бачить «коли востаннє діяв», «що зробив агент», лог у `outreach_actions` із `actor='user_account'`.
- **Manual mode:** на кожному prospect-row кнопки «Коментар (від мене)», «DM (від мене)», «👍/👎» — відкривають Sheet з preview тексту, ESC=cancel, Enter=send.
- **Agent mode:** новий agent `agents.outreach-user-engager` — періодично сканує prospects зі статусом `new` + intent_score > 0.5, обирає action за risk-mode, виконує через runner, пише результат у `outreach_actions`.
- **Compliance:** показуємо warning при підключенні («ваш особистий аккаунт — Telegram може забанити за спам, MARQ не несе відповідальності»). Logs зберігаються 90д для аудиту.

**Етапи (коли почнемо):**
1. DB: `tenant_configs.bot.telegram_user` JSONB (session_encrypted, phone, last_login_at, quotas), міграція + RLS
2. External runner repo / Inngest function для MTProto (gramjs)
3. UI Login flow (phone code + 2FA) → encrypted session save
4. Manual actions UI (3 кнопки на prospect)
5. `agents.outreach-user-engager` із risk-mode
6. Compliance warning, logs viewer, kill-switch

### Sprint 21 (planned) — Скарги на Telegram (reports на чат / канал / бот / профіль / повідомлення)
**Мета:** дати власнику (вручну) і агентам (автоматично, з обережністю) можливість надсилати **офіційні скарги** в Telegram на спам/фрод/контрафакт, що шкодить бренду — без виходу з кабінету MARQ.

**Сценарій використання:**
- Outreach Hunter / Lead Radar знайшов канал, що паразитує на бренді (фейковий магазин «BASIC.FOOD», скам-бот, фішинг-група) → одна кнопка «Поскаржитись» → агент обирає категорію скарги, генерує текст обґрунтування, відправляє.
- Кожна скарга логається з тенант-ідентифікатором, причиною, текстом, відповіддю Telegram, статусом.

**Що скаржимо (Telegram entity types):**
- **Channel** (`@channel`) — публічний канал
- **Group / Supergroup** (`@chat`) — публічний чат
- **Bot** (`@bot`) — автоматизований бот
- **User profile** (`@username`) — особистий акаунт
- **Message** — конкретне повідомлення (потрібен `chat_id` + `message_id`)

**Категорії скарги (з офіційного Telegram API — `InputReportReason`):**
- `inputReportReasonSpam` — спам
- `inputReportReasonViolence` — насильство
- `inputReportReasonPornography` — порнографія
- `inputReportReasonChildAbuse` — насильство над дітьми
- `inputReportReasonCopyright` — порушення авторських прав
- `inputReportReasonGeoIrrelevant` — нерелевантна геолокація
- `inputReportReasonFake` — фейковий акаунт / видавання себе за інший бренд
- `inputReportReasonIllegalDrugs` — нелегальні наркотики
- `inputReportReasonPersonalDetails` — розголошення персональних даних
- `inputReportReasonOther` — інше (з обов'язковим текстом-описом)

**Архітектурні обмеження (важливо!):**
- **Bot API НЕ підтримує скарги.** Жоден `report*` метод недоступний через Telegram Bot API → **тільки MTProto (user-mode)**. Тобто скарги йдуть через ту ж саму external-runner інфраструктуру, що й Sprint 20 (gramjs).
- Без активної user-session (Sprint 20) функціонал **disabled** — UI показує блокер «Підключіть особистий Telegram-акаунт у налаштуваннях».
- Telegram rate-limits скарги жорстко (флуд-вейт + бан за зловживання) → жорсткий quota: **≤5 скарг/добу/тенант**, **≤1 скарга/хв**, **≤1 скарга на ту саму ціль/30 днів**.

**DB:**
- Нова таблиця `telegram_abuse_reports`:
  - `id`, `tenant_id`, `actor` ('owner' | 'agent:<agent_id>'), `actor_user_id` (auth.users.id або null для агента)
  - `target_kind` ('channel' | 'chat' | 'bot' | 'user' | 'message')
  - `target_username` (text, nullable), `target_chat_id` (bigint, nullable), `target_message_id` (bigint, nullable)
  - `reason_code` (enum 10 значень з InputReportReason)
  - `reason_text` (text — згенерований агентом обґрунтовуючий опис)
  - `status` ('queued' | 'sent' | 'failed' | 'rejected_quota' | 'rejected_duplicate')
  - `telegram_response` jsonb, `error` text
  - `requested_at`, `sent_at`
  - INDEX(tenant_id, requested_at DESC), UNIQUE(tenant_id, target_username, target_chat_id, target_message_id, reason_code) WHERE sent_at > now() - interval '30 days'
- RLS: тенант бачить тільки свої записи; запис створює тільки owner/admin або service-role (для агента)

**UI (новий компонент `TelegramReportDialog.tsx`):**
- Викликається з: Lead Radar prospect-row, Outreach Hunter post-row, та з контекстного меню в `OrderTelegramChat`
- 3 кроки:
  1. **Target** — auto-fill з контексту (channel/chat/bot/user/message), readonly preview
  2. **Reason** — select з 10 категорій (i18n labels UA/EN), із підказкою-описом для кожної
  3. **Generate text** — кнопка «Згенерувати обґрунтування» → Lovable AI Gateway (`google/gemini-2.5-flash-lite`, бо текст короткий) → готовий текст у textarea (editable)
  4. **Submit** → `POST /api/telegram/report` → чергу runner-у
- Показ quota: «Сьогодні: 2/5 скарг», «Остання скарга на цей канал: 12 днів тому»

**Agent mode (`agents.telegram-report-watchdog`):**
- Сканує `prospects` + `outreach_actions` із signals `is_brand_impersonation`, `is_scam`, `copyright_violation`
- Для кандидатів **risk≤medium** → автоматично формує скаргу (reason=`inputReportReasonFake` або `inputReportReasonCopyright`)
- Для **risk=high** → створює `pending_approval` запис, owner затверджує в UI
- Виконується раз на добу, не швидше

**Server flow:**
- `src/routes/api/telegram.report.ts` (POST, auth required):
  1. Validate Zod schema (target_kind + reason_code + reason_text 50-500 chars)
  2. Quota check (5/добу, 1/30д на ту саму ціль)
  3. Insert `telegram_abuse_reports` зі status='queued'
  4. Trigger external runner (Sprint 20 інфра) → MTProto `messages.report` / `account.reportPeer` / `channels.reportSpam`
  5. Runner оновлює status='sent'/'failed', telegram_response
- Runner-side (Node host): `gramjs` `client.invoke(new Api.messages.Report({...}))`

**Compliance & UX:**
- Warning в Dialog: «Скарга — серйозна дія. Telegram перевіряє ручно. Зловживання → бан вашого акаунта.»
- Логи доступні в `/admin/lead-radar` → таб «Скарги»
- Owner може скасувати queued-скаргу (поки runner не виконав)
- Agent-mode default = **OFF** (toggle в `outreach_settings.user_account.reports_enabled`)

**Етапи (коли почнемо):**
1. DB: міграція `telegram_abuse_reports` + RLS + UNIQUE constraint
2. UI: `TelegramReportDialog` + інтеграція в Lead Radar / Outreach Hunter row-actions
3. Server: `/api/telegram/report` (queue insert + quota)
4. Runner-side: gramjs `messages.report` + status update
5. Agent: `agents.telegram-report-watchdog` (auto reports на impersonation/copyright)
6. Логи + history view в `/admin/lead-radar` таб «Скарги»
7. i18n: 30+ нових ключів (10 reason labels × 2 мови + UI strings)

