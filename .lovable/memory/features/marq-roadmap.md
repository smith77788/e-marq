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

### Sprint 4 — Email + Payments ✅ (email готовий)
- Resend gateway, templates, webhooks, suppression, unsubscribe ✅
- EmailDomainCard, EmailCampaignsCard ✅
- ⏳ Платежі: LiqPay, WayForPay, Monobank — НЕ зроблено
- TenantConfigForm: розширити поля payments/shipping/email

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
