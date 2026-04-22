---
name: MARQ V2 Source-of-Truth Prompt
description: Постійне джерело істини для розробки MARQ. Повний 1729-рядковий V2-промпт лежить у .lovable/MARQ_PROMPT_V2.md. Описує DB foundation, storefront, brand admin, email engine, shipping, payments, нові ACOS-агенти, sidebar, storage. Sprints 1-9 закриті (див. marq-roadmap). Залишкові гепи: bulk-генератор промокодів, формальний multi-step Campaigns Wizard, можливі дрібні поліровки brand.products tabs.
type: feature
---

# MARQ V2 — джерело істини

Повний промпт зберігається у файлі проєкту: `.lovable/MARQ_PROMPT_V2.md` (1729 рядків). Завжди читай його перед новою фічею MARQ — він описує:

- 7-крок цикл (READ→PLAN→WRITE→CHECK→IMPROVE→CHECK→DELIVER)
- технічний стек (TanStack Start + Vite + Cloudflare Workers + Supabase)
- повну карту існуючого коду (routes, components, DB схема)
- ключові утиліти (agentRuntime, money, i18n, supabase clients, cart)
- 5 обов'язкових патернів (server function, React+TanStack Query, authenticated route, migration, register agent)
- 9 блоків реалізації (DB foundation, storefront, brand admin, email, shipping, payments, agents, sidebar, storage)
- порядок виконання (6 спринтів)
- self-verification checklist
- абсолютні заборони

## Поточний статус (станом на 2026-04-22)

Sprints 1-9 виконані (див. `mem://features/marq-roadmap`). Перевірений аудит проти V2-промпту:

✅ Готово
- catalog v2 (product_variants, product_images, collections, RPCs)
- storefront layout / index / product / collection / search / checkout
- brand.products(+productId tabs), brand.orders, brand.catalog, brand.promotions, brand.email (3 таби)
- email engine: Resend gateway, 5 шаблонів, webhook, suppression, unsubscribe, EmailDomainCard, EmailCampaignsCard (single-screen wizard), EmailAutomationsCard
- payments: LiqPay/WayForPay/Monobank server libs + init/callback routes + UI у TenantConfigForm + checkout RadioGroup
- shipping: NP-cities/NP-warehouses proxy + ShippingSelector
- 5 нових email-агентів (abandoned-cart/winback/post-purchase/order-status-notifier/restock-notifier) + автоматизаційні toggle

❌ Лишилися гепи з V2:
- Bulk-генератор промокодів + CSV (V2 рядок 1180-1183)
- Формальний multi-step Campaigns Wizard (Step 1→2→3→4) — поточний EmailCampaignsCard покриває логіку, але один екран

## Як використовувати

1. Перед новою фічею MARQ — `code--view .lovable/MARQ_PROMPT_V2.md` потрібний блок.
2. Дотримуйся 7-крок циклу для **кожного** файлу.
3. Перед PR / здачею — пройди self-verification checklist (рядки 1662-1697 промпту).
4. Жодних порушень абсолютних заборон (рядки 1700-1714 промпту).
