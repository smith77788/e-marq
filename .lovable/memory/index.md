# Memory: index.md

# Project Memory

## Core
ACOS = головний продукт: multi-tenant Autonomous Revenue OS для D2C-брендів.
Архітектура за зразком My Food Diary: ai_insights → orchestrator → 1-click apply → ai_memory feedback loop.
Storefront/Products/Orders = вторинна "commerce shell", не основа продукту.
Нові фічі будують ACOS-агенти (cron edge functions які пишуть insights), не e-commerce.
Auto-apply with approval queue: агенти пропонують дії, власник апрувить батчами.
First pilot tenant = MFD-like синтетичний 90-day dataset.
Real pilot tenant = BASIC.FOOD (натуральні ласощі для собак/котів, UA).
Працювати ретельно: робити, перевіряти, допрацьовувати, перевіряти ще раз — поки не ідеально.

## Memories
- [MARQ implementation roadmap](mem://features/marq-roadmap) — 6-Sprint план: catalog v2, storefront expansion, email engine, promotions, loyalty, shipping, payments (LiqPay/WayForPay/Mono), нові ACOS-агенти. Абсолютні заборони: не редагувати існуючі міграції, не міняти agentRuntime.ts, не виставляти платіжні ключі клієнту.
