# Memory: index.md
Updated: today

# Project Memory

## Core
ACOS = головний продукт: multi-tenant Autonomous Revenue OS для D2C-брендів.
Архітектура за зразком My Food Diary: ai_insights → orchestrator → 1-click apply → ai_memory feedback loop.
Storefront/Products/Orders = вторинна "commerce shell", не основа продукту.
Нові фічі будують ACOS-агенти (cron edge functions які пишуть insights), не e-commerce.
Auto-apply with approval queue: агенти пропонують дії, власник апрувить батчами.
First pilot tenant = MFD-like синтетичний 90-day dataset.
AI Lovable credits НЕ витрачати: усі AI-completions guard через `isLovableAiEnabled()` з `@/lib/acos/aiKillswitch`. За замовчуванням вимкнено. Деталі: mem://constraints/no-lovable-ai-credits.

## Memories
- [No Lovable AI credits](mem://constraints/no-lovable-ai-credits) — Killswitch для всіх AI completions, 4 точки застосування, fallback-стратегія
