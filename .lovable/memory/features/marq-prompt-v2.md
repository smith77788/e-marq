---
name: MARQ V2 Source-of-Truth Prompt
description: Постійне джерело істини для розробки MARQ. Повний 1729-рядковий V2-промпт лежить у .lovable/MARQ_PROMPT_V2.md. Описує DB foundation, storefront, brand admin, email engine, shipping, payments, нові ACOS-агенти, sidebar, storage. Sprints 1-9 закриті. Обидва залишкові гепи (bulk promo generator, multi-step Campaigns Wizard) тепер імплементовані. V2 повністю покрита.
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

## Поточний статус (станом на 2026-04-22, після пакету покращень)

Sprints 1-9 виконані. **Обидва залишкові гепи закриті**:

✅ Bulk-генератор промокодів — `src/components/owner/BulkPromoGeneratorDialog.tsx`

- Дет-preview формату, batch INSERT з ретраєм проти колізій
- CSV-завантаження client-side, повний i18n (UA+EN, ~16 ключів `bpr.bulk.*`)
- Підключений у `brand.promotions.tsx` (кнопка `bpr.bulk.button`)

✅ Multi-step Campaigns Wizard — `src/components/owner/EmailCampaignWizard.tsx`

- Підключений у `brand.email.tsx` Tab "Кампанії" поряд з EmailCampaignsCard

## Останні системні покращення (поза V2)

✅ Detail Drawer (universal) — `DetailController` + `DetailableElement` + `useDetailData`
✅ Owner Plan Switcher — `src/components/owner/OwnerPlanSwitcher.tsx`
✅ MFA TOTP enrollment + AAL2 challenge gate — `MfaSetupCard` + `MfaChallengeGate`
✅ Notification Center — bell icon з realtime + DB trigger `tg_mirror_insight_to_notifications`
✅ Global Search ⌘K — `src/components/layout/GlobalSearch.tsx` (pages, products, orders, customers, insights)
✅ Improved InsightToasts — filter по risk_level (high/critical), failed agent runs, action buttons

## Як використовувати

1. Перед новою фічею MARQ — `code--view .lovable/MARQ_PROMPT_V2.md` потрібний блок.
2. Дотримуйся 7-крок циклу для **кожного** файлу.
3. Перед PR / здачею — пройди self-verification checklist (рядки 1662-1697 промпту).
4. Жодних порушень абсолютних заборон (рядки 1700-1714 промпту).
