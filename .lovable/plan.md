## Що болить

1. **Новий бренд = `pending`** → `/brand/integrations` ховає всі кнопки «Підключити» і «Синхронізувати» поки супер-адмін не клікне «Approve». На практиці перші 24 години людина не може ні CSV завантажити, ні Shopify підключити. Це і є «не може легко під'єднати свій бізнес».
2. **DN Trade всюди в UI**, навіть у тих, хто про неї ніколи не чув: посилання в лівому сайдбарі (`/admin/dntrade-health`), картка-плашка на дашборді бренду коли інтеграції немає (зараз guard повертає `null`, але імпорт компонента + назва провайдера-«першокласника» лишилися), варіанти у вікні підключення.
3. **Onboarding wizard** проводить через 7 кроків, але крок 5 (Tracking) і крок 4 (Customers CSV) не показують одного цілісного шляху «імпортуйте товари + клієнтів + замовлення зі своєї системи». Користувачу не зрозуміло, що головна цінність — синхронізація.
4. **Каталог інтеграцій** показує 25+ карток, з яких реально працюють лише 8 (Shopify/Woo/Stripe/Bitrix24/Poster/Sheets/REST/DN Trade). Решта — «comingSoon». Це створює відчуття «нічого не працює». Treба піднімати ready-картки нагору і чесно групувати.
5. **Перший «success moment»** після створення бренду — порожньо. Немає preset-демо, немає «імпортуй демо-каталог щоб побачити як виглядає магазин».

## План (тільки реальні зміни, без рефакторингу заради рефакторингу)

### Phase 1 — Розблокувати новий бренд одразу (найважливіше)

**Migration:**
- Поміняти `create_my_tenant`: новий tenant — одразу `status='active'`, але з прапорцем `verification_requested_at`. Супер-адмін може потім «verify» для розширених фіч (вищі ліміти, кастомний домен), але імпорт/Telegram/CSV — доступні з першої секунди.
- Оновити `_authenticated/brand.integrations.tsx`: прибрати `isTenantActive`-gate (або лишити лише для платних інтеграцій типу custom domain). Дозволити Connect/Sync для всіх ready-провайдерів.
- На `/brand` залишити м'який банер «Бренд новий — деякі ліміти знижені поки не верифікований», без блокувань.

### Phase 2 — Убрати DN Trade-«першокласний» статус

- `AppSidebar.tsx` → пункт «DN Trade Health» показувати тільки якщо у tenant є `tenant_integrations.provider='dntrade'` (або super-admin). Зараз він у всіх адмінів навіть без DN.
- `brand.index.tsx` → DnTradeIntegrationCardGuard вже умовний; залишити, але видалити безумовний `import` (опційний import не виконується тільки якщо є дані → import все одно є). Залишити як є — guard працює, прибрати лише якщо помітно впливає на bundle.
- `IntegrationsHubPage`: пересортувати — спершу `status='ready'`, потім `beta`, в кінці `comingSoon`. Додати фільтр `Tabs` ще одну вкладку «Готові зараз».

### Phase 3 — Один цілісний «Connect your store» крок в onboarding

Замість поточних окремих Steps 3 (товари вручну) + 4 (CSV клієнтів):
- Об'єднати в один крок «Підключіть джерело даних» з трьома великими опціями:
  1. **«У мене є магазин Shopify/WooCommerce/REST»** → відкриває `IntegrationWizard` з відповідним провайдером.
  2. **«Імпортую CSV/Excel»** → відкриває file-based wizard, мапить products+customers+orders.
  3. **«Додам товари вручну»** → теперішня форма Step3.
- Step 3 (старий) лишити як fallback всередині опції 3.

### Phase 4 — Demo data на 1 клік

- Додати RPC `seed_demo_catalog(_tenant_id)` (SECURITY DEFINER, owner-only), що створює 6 демо-товарів + 3 клієнтів + 5 замовлень за останні 14 днів. На дашборді бренду коли `products.count=0` показати CTA «Заповнити демо-каталогом, щоб побачити як працює система».
- Демо-дані позначені `payload->>'demo'='true'` щоб потім легко прибрати кнопкою «Очистити демо».

### Phase 5 — Verify & ship

1. Створити дві тестові сесії (через існуючі tenants Coffe shops, Кавовий рай) — переконатися, що в обох усі фічі working. 
2. Прогнати `cron.job_run_details` + `acos_agent_runs` 2h після Publish.
3. Оновити mem://core про нову політику «новий бренд = active».

## Файли, які точно змінюються

- `supabase/migrations/<ts>_unblock_new_tenants_and_demo_seed.sql` (нова)
- `src/routes/_authenticated/brand.integrations.tsx`
- `src/components/layout/AppSidebar.tsx`
- `src/routes/_authenticated/brand.index.tsx` (легенький rewording банера)
- `src/routes/_authenticated/onboarding.tsx` (новий Step3 «Connect store»)
- `src/lib/integrations/catalog.ts` (поле `priority` для сортування)
- `src/components/owner/SeedDemoButton.tsx` (нова)
- `mem://index.md` + `mem://features/easy-onboarding` (нова memory)

## Чого НЕ робимо

- Не чіпаємо storefront, checkout, бот-pipeline, ACOS-агентів, pure-SQL гілку, pricing, billing — вони працюють.
- Не реалізуємо нові API-конектори (Etsy/Amazon/QuickBooks тощо) — це окремий великий ескоп.
- Не міняємо Cron / CRON_SECRET / engines.

Готовий запустити Phase 1+2+3+4+5 в одному заході. Чи затверджуєш план?
