# Project Memory

## Core
ACOS = головний продукт: multi-tenant Autonomous Revenue OS для D2C-брендів.
Архітектура за зразком My Food Diary: ai_insights → orchestrator → 1-click apply → ai_memory feedback loop.
Storefront/Products/Orders = вторинна "commerce shell", не основа продукту.
Нові фічі будують ACOS-агенти (cron edge functions які пишуть insights), не e-commerce.
Auto-apply with approval queue: агенти пропонують дії, власник апрувить батчами.
First pilot tenant = MFD-like синтетичний 90-day dataset.
Внутрішні артефакти (магніти, content_pages, drafts, insights body) у адмінці завжди показувати inline через Dialog/Drawer — не редіректити на публічні /m/ /s/ сторінки.

## Memories
- [MARQ Roadmap](mem://features/marq-roadmap) — спринти 1-12, Outreach Hunter, Site Builder, Email automations, inline preview правило.
