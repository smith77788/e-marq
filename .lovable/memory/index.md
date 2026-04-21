# Project Memory

## Core
ACOS = головний продукт: multi-tenant Autonomous Revenue OS для D2C-брендів.
Архітектура за зразком My Food Diary: ai_insights → orchestrator → 1-click apply → ai_memory feedback loop.
Storefront/Products/Orders = вторинна "commerce shell", не основа продукту.
Нові фічі будують ACOS-агенти (cron edge functions які пишуть insights), не e-commerce.
Auto-apply with approval queue: агенти пропонують дії, власник апрувить батчами.
First pilot tenant = MFD-like синтетичний 90-day dataset.
Порт 88 MFD-функцій у 45 generalized агентів — батчами по 5. Інфраструктура (22 таблиці) вже готова.
Реальна кількість агентів у системі: 65 робочих + 8 оркестраторів (cron-all, run-all, tick, *-all). У UX/посібнику говоримо "65+". НЕ використовувати число "27" — це була стара заглушка.
Мова за замовчуванням — українська (проста, зрозуміла кожному, без жаргону), EN — як опція через LanguageSwitcher. Усі тексти інтерфейсу йдуть через useT/tStatic з src/lib/i18n.ts.

## Memories
- [MFD port roadmap](mem://features/mfd-port-roadmap) — мапа 88 MFD-функцій → 45 generalized агентів, прогрес по батчах
- [Visual roadmap](mem://preferences/visual-roadmap) — dark/light toggle + charts з insights/БД, поступовий polish UI
