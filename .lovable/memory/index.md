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
ОБОВ'ЯЗКОВИЙ 7-крок цикл: Read→Plan→Write→Check→Improve→Check→Deliver. Не здавати, поки не ідеально.
Money лише в cents (integer). i18n через useT() / tStatic() в обох мовах (ua + en). tenant_id у кожному запиті.
supabaseAdmin лише в hooks/ і *.server.ts. Нові таблиці = RLS + INDEX(tenant_id) + updated_at trigger.

## Memories
- [MARQ V2 work protocol](mem://preferences/work-protocol) — Ultra-precise 7-крок цикл верифікації для кожного файлу. Self-checklist + абсолютні заборони (не міняти існуючі міграції, не виставляти платіжні ключі клієнту тощо).
- [MARQ implementation roadmap](mem://features/marq-roadmap) — 6+ Sprint план: catalog v2 ✅, storefront ✅, email ✅, promotions+loyalty ✅, UA payments (LiqPay/WayForPay/Mono) ✅, нові ACOS-агенти ✅. Next: shipping (NP/Justin/Meest), brand.email UI, кампанії wizard, restock UI на storefront.
