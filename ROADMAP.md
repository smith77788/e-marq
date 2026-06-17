# MARQ / e-marq — Roadmap v0.1 → v1.0

Чесна оцінка стану продукту за результатами наскрізного аудиту (2026-06-12).
Мета v1.0: новий власник за один сеанс підключає бізнес, отримує налаштовувану
вітрину з реальними даними, а агенти виконують роботу, а не імітують її.

Статус-легенда: ✅ зроблено · 🟡 частково · ❌ дірка/заглушка.

---

## 1. Підключення бізнесу (новий власник)

| Крок | Статус | Примітка |
|------|--------|----------|
| Реєстрація → tenant active | ✅ | `create_my_tenant`, одразу active, FREE-план + 200 кредитів |
| Онбординг 7 кроків | ✅ | бренд, telegram, товар, клієнти, tracking, оплата, команда |
| Демо-каталог 1 кліком | ✅ | `seed_demo_catalog` RPC + `SeedDemoButton` |
| **UI для платіжних ключів (LiqPay/WayForPay/Monobank)** | ✅ (нове) | **вкладка «Оплата» в `brand.settings`. Секрети write-only: читаються через `get_tenant_payment_settings` (лише has_*_saved прапорці, не самі ключі), пишуться через `update_tenant_payment_settings` (NULL = лишити збережений). Раніше форма була лише в адмін-панелі.** |
| **Витік секретів через `get_storefront_config`** | ✅ (нове) | **був CRITICAL: SECURITY DEFINER RPC віддавала весь `features.payments` (включно з приватними ключами) анонімам. Тепер whitelist 8 безпечних полів + defense-in-depth у завантажувачі вітрини. ⚠️ ключі, збережені до фіксу, могли витекти — ротувати.** |
| Оплата при зміні підписки | ✅ (нове) | **`create_subscription_payment` RPC + `/api/subscription/init` + `/api/subscription/callback`. OwnerPlanSwitcher інтегровано з LiqPay: paid plans → redirect на оплату, free plans → `owner_change_plan` напряму. Міграція `subscription_payments` таблиці.** |
| Валідація tracking (крок 5) | 🟡 | лише чекбокс `features.tracking_installed`, реальна перевірка пікселя відсутня |
| Імпорт товарів | 🟡 | CSV/ручний працює; немає простого Shopify/маркетплейс-конектора в UI |

## 2. Вітрина та кастомізація

| Область | Статус | Примітка |
|---------|--------|----------|
| Каталог, товар, кошик, checkout, пошук, wishlist | ✅ | наскрізно працює |
| SEO (jsonLd, sitemap, robots, OG) | ✅ | динамічні |
| **Кольори бренду на вітрині** | ✅ (нове) | **був баг: вітрина читала `ui.primary`, форма писала `primary_color` → кольори не застосовувались. Виправлено в `s.$slug.tsx`.** |
| **Редактор hero + смуга-оголошення** | ✅ (нове) | **вкладка «Вітрина» в `brand.settings`. Раніше поля рендерились, але їх не було де задати.** |
| Сторінки About / FAQ / Контакти | ✅ | Маркетингові сторінки працюють (/about, /handbook, /contact) |
| Завантаження зображень (лого/hero/банер) | ✅ (нове) | **`ImageUploadField` у brand.settings (лого, hero, OG) + Supabase Storage bucket `brand-assets` (публічне читання, запис лише членам tenant'а під своїм префіксом; міграція 20260612034301)** |
| Власний домен (маршрутизація вітрини) | ❌ | DNS-верифікація є (`DomainsManager`), але вітрина доступна лише за `/s/$slug`; немає edge-маршрутизації за Host |
| Фільтри/сортування каталогу | ✅ (нове) | **`CatalogFilters` на головній вітрини: ціна (діапазон), колекція, наявність; стан у URL (zod search params), комбінується з сортуванням** |
| Live-прев'ю налаштувань | ❌ | власник не бачить вітрину з адмінки |

## 3. Агенти (чесність роботи)

~67% агентів читають реальні дані й пишуть валідні insights. Головні діри:

| Проблема | Статус | Примітка |
|----------|--------|----------|
| **insight → apply: лише ~8 типів мали обробник** | 🟡 | решта писали insight, але дія не виконувалась |
| **`churn_risk` / `winback_touch` = no-op** | ✅ (нове) | **був `{ note: "Action recorded." }`. Тепер `queueWinbackTouch`: реальний персональний промокод + outbound-повідомлення клієнту (`actions.apply.ts`).** |
| Обробники для `broadcast_suggestion`, `seo_rewrite_opportunity`, `bootstrap_catalog_*`, `search_gap` | ✅ (нове) | **усі 4 типи тепер виконують реальну дію в `actions.apply.ts`: broadcast → fan-out `outbound_messages` (ліміт 500, канал telegram→email); search_gap → чернетка SEO-лендінгу в `content_pages` (власник публікує сам); seo_rewrite → детермінований rewrite seo_title/seo_description (missing_seo — лише порожні поля); bootstrap_catalog → чек-лист власнику через `owner_notifications` (Telegram push). + захист від повторного apply (`already_applied`).** |
| `ltv-predictor` churn — хардкод порогів | ✅ | **Замінено на data-driven RFM модель: recency (50%) + frequency (30%) + monetary (20%). Динамічні пороги для сегментації.** |
| sales-bot AI вимкнено за замовчуванням | 🟡 | свідомий killswitch (економія кредитів); вмикається `ACOS_AI_ENABLED=1` + `LOVABLE_API_KEY` |
| `acos_agent_runs.status='success'` при 0 дій | 🟡 | прогін без знахідок виглядає як успіх — потрібен окремий стан `noop`/`no_data` |

## 4. Потік даних

| Ланцюг | Статус | Примітка |
|--------|--------|----------|
| Події вбудованої вітрини (`content_viewed`, `product_viewed`, `add_to_cart`, `checkout_started`, `purchase_completed`) | ✅ | пишуться напряму через `track()` |
| Зовнішній сніпет `/track/$slug.js` → `/hooks/ingest` | ✅ | endpoint існує (`hooks/ingest.ts`) — аудит спершу помилково вважав його відсутнім |
| Замовлення → `place_storefront_order` → orders/items → дашборди | ✅ | KPI читають реальні таблиці, без demo-фолбеку |
| Email (Resend) / Telegram | 🟡 | реальні API, але потребують env-ключів (`RESEND_API_KEY`, `TELEGRAM_API_KEY`, `LOVABLE_API_KEY`); без них черга `outbound_messages` не відправляється |
| Обробка черги `outbound_messages` | 🟡 | `engines.dispatch` працює, але залежить від регулярного pg_cron |
| Webhook-імпорт vs ручний імпорт | 🟡 | дві окремі гілки коду (`integrations.inbound.$provider` inline vs `importer.ts`) — ризик розходження |

---

## Пріоритети до v1.0 (за впливом)

1. ~~Платіжні credentials UI~~ ✅ + ~~закрити витік секретів~~ ✅
2. **Власний домен** — RPC `get_tenant_by_domain` ✅; лишилась едж-маршрутизація за Host (middleware/SSL — потребує Cloudflare-інфри, відкладено).
3. ~~Завершити insight→apply~~ ✅ — winback, broadcast, search_gap, seo_rewrite, bootstrap_catalog.
4. ~~Сторінки About/FAQ~~ ✅ + ~~файл-аплоадер~~ ✅ (`ImageUploadField` + bucket `brand-assets`).
5. **Доставка `outbound_messages`** — ретраї невдалих + ідемпотентність (потребує узгодженої зміни 7 inserter'ів + UNIQUE; відкладено).
6. ~~Хардкод у `ltv-predictor`~~ ✅
7. **Оплата підписки** — ✅ ЧАСТКОВО: payment intent для планів створюється, LiqPay callback обробляється, `subscription_payments` таблиця. Потребує тестування в продакшені + додавання WayForPay/Monobank.
8. **RLS `get_public_order`** — 🔴 ВІДКЛАДЕНО (рішення власника): дані замовлення доступні за order_id (UUIDv4 — не brute-forceable, ризик = поширений/витеклий URL). Фікс через `public_access_token` готовий у плані, але торкається checkout-RPC + обох payment-init redirect + email + account page; застосовувати лише з можливістю протестувати весь потік оплата→сторінка-замовлення.

> Зроблено 2026-06-12 (мультиагентна хвиля аудиту, 20 агентів):
> кольори бренду, редактор hero+оголошення, реальний `winback_touch`, платіжний
> UI власника + закриття витоку платіжних секретів; **+ хвиля виправлень**:
> 500-на-помилку в усіх 3 платіжних callback'ах (ретрай шлюзу), onboarding CSV
> email-колонка, чесні лічильники інсайтів у дайджест-агентів, сортування на
> вітрині, perf-індекси, ліміт sitemap, `get_tenant_by_domain`, неперервний
> churn у ltv, безпечне очищення кошика при оплаті.

> Зроблено 2026-06-17 (аудит перед 1M + максимальний буст):
> **Аудит + фікси:**
> - Покращено обробку помилок на сторінках /s/*
> - PWA manifest.json з іконками та темою
> - Cookie consent banner (GDPR/UA compliance)
> - Honeypot CAPTCHA на формах contact та signup
> - Уніфіковано кількість агентів (70+ marketing, 58 catalog)
> - Оновлено описи тарифів у handbook
> - Додано інформацію про компанію на About
> - Створено підписковий billing: subscription_payments + LiqPay
> - Auth graceful degradation без env vars
> - Security: subscription.init.ts auth, RLS conversations, CORS whitelist
> - Rate limiting: ai.ask (5/min), email.campaign-send (2/min)
> - Checkout loyalty re-validation, monobank duplicate invoice fix
> - SEO: canonical URL, sitemap, dynamic lang, account noindex
> - Performance: 6 indexes, winback N+1 batch (250→5 queries)
> - Agent system: finishAgentRun error propagation, actions.apply failure handling
> - Pre-existing TS errors fixed (RestockSubscribe, navigate, null→undefined)
> **Smart Engines (для #1 в світі):**
> - AI Gateway: MiMo Code (безкоштовний) + Lovable fallback
> - Upsell Engine: market basket analysis + AI personalization
> - Revenue Recovery: 5 каналів витоків (cart, churn, pricing, products, AOV)
> - Email Automation: 3 ланцюжки (cart abandonment, winback, post-purchase)
> - Smart Notifications: revenue alerts + stock monitoring
> - Pricing Engine: demand-based dynamic pricing
> - Customer Segmentation: 7 поведінкових сегментів
> - Inventory Forecasting: попит + reorder рекомендації
> - A/B Testing: statistical significance + auto-apply
> - SEO Optimizer: auto meta tags + AI descriptions + keywords
> - Social Proof: real-time sales data + reviews
> - Shipping Optimizer: carrier comparison + cost analysis
> - Fraud Detection: risk scoring + automatic blocking
> - Recommendation Engine: collaborative + content-based + trending
> - CLV Predictor: lifetime value + churn scoring
> - Promotion Engine: auto welcome/winback promos
> - Analytics Dashboard: агрегація всіх engine
