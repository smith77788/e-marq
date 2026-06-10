# MARQ / ACOS — Roadmap Q2 2026

> Створено після аудиту повного codebase (105 агентів, 98 таблиць, 225 routes, 148 компонентів).
> Документ — джерело істини для пріоритезації. Оновлюється після кожного спринту.

---

## 🎯 North Star

ACOS = **Autonomous Revenue OS для D2C-брендів**.
Все інше (storefront, products, orders) — обслуговує цю місію.

**Метрика успіху Q2:** 3 пілотні бренди в Україні + 1 у PL з working self-heal + Shopify-онбордингом за <30 хв.

---

## 🔥 Sprint 12 — Security & Hygiene (1-2 дні)

**Ціль:** прибрати критичні ризики, які блокують зовнішній аудит/інвестора.

| #    | Задача                                                                        | Приорітет | Estimate |
| ---- | ----------------------------------------------------------------------------- | --------- | -------- |
| 12.1 | `git rm --cached .env` + ротація Supabase publishable+service keys            | 🔴 P0     | 30хв     |
| 12.2 | Аудит `secrets--fetch_secrets` → переконатись що все live в Cloud, не в git   | 🔴 P0     | 20хв     |
| 12.3 | `.gitignore` review: `.env*`, `/dist`, `/.output`, `/.tanstack`, `/.wrangler` | 🟡 P1     | 10хв     |
| 12.4 | Запустити `security--run_security_scan`, виправити HIGH findings              | 🟡 P1     | 1-2год   |
| 12.5 | Document security posture у `mem://security/posture`                          | 🟢 P2     | 30хв     |

**Definition of done:** жодного секрету в git, security scan без HIGH/CRITICAL.

---

## 🟡 Sprint 13 — Page Completeness (1 день)

**Ціль:** усунути stub-сторінки, які виглядають порожніми для нового тенанта.

| #    | Задача                                                                                                                                                                        | Estimate |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 13.1 | `brand.customers.tsx` — повна сторінка: TopCustomers + LifecycleDistribution + CohortRetention + CustomerRoster (компоненти вже існують, треба лише композиція + emptyStates) | 1.5год   |
| 13.2 | `brand.channels.tsx` — додати health-метрики каналів (24h success rate, paused-by-self-heal badge), keep ChannelSetup + IntegrationGuide                                      | 1год     |
| 13.3 | `brand.insights.tsx` — перевірити, чи всі insight-types з `acos_insights` рендеряться                                                                                         | 30хв     |
| 13.4 | **NEW** `s.$slug.account.tsx` — customer-facing особистий кабінет: orders history, wishlist, addresses, logout                                                                | 2год     |
| 13.5 | Додати link на `/account` в storefront header (`s.$slug.tsx`) для logged-in customer                                                                                          | 20хв     |

**DoD:** усі brand-сторінки мають повний UX без "TODO" чи порожніх станів. Storefront customer бачить свою історію.

---

## 🟠 Sprint 14 — Shopify Connector (2-3 дні)

**Ціль:** найбільший unlock для онбордингу. Більшість D2C вже на Shopify.

| #    | Задача                                                                                                                    | Estimate |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| 14.1 | Реєстрація connector у `src/lib/integrations/catalog.ts` + OAuth wizard                                                   | 3год     |
| 14.2 | `src/lib/integrations/shopify/client.ts` — Admin API wrapper (products, orders, customers, inventory)                     | 4год     |
| 14.3 | `src/routes/hooks/agents.shopify-sync.ts` — продукт + остатки sync agent (cron-друг)                                      | 3год     |
| 14.4 | `src/routes/api/public/integrations.inbound.shopify.ts` — webhook receiver (orders/create, products/update) з HMAC verify | 2год     |
| 14.5 | Mapping shopify_product_id → внутрішній `products.external_id` + dedup логіка                                             | 2год     |
| 14.6 | UI: статус синхронізації + last_sync_at у `brand.integrations.tsx`                                                        | 1год     |
| 14.7 | Migration: `shopify_credentials` table з encrypted access_token                                                           | 1год     |

**DoD:** новий тенант підключає Shopify за 3 кліки, бачить products/orders в MARQ протягом 5хв.

---

## 🟠 Sprint 15 — Test Foundation (1.5 дні)

**Ціль:** мінімальна страховка перед агресивним рефакторингом.

| #    | Задача                                                                                       | Estimate |
| ---- | -------------------------------------------------------------------------------------------- | -------- |
| 15.1 | `vitest` + `@testing-library/react` setup, `bun test` script                                 | 30хв     |
| 15.2 | Smoke-тести `agentRuntime`: startAgentRun → finishAgentRun → failAgentRun → telemetry insert | 2год     |
| 15.3 | Unit-тести 5 self-heal детекторів (mock supabase)                                            | 3год     |
| 15.4 | Integration-тест `selfHealCycle` end-to-end (детектор → incident → action apply → revert)    | 2год     |
| 15.5 | Critical path: checkout flow (cart → order → payment_intent → callback) — happy path         | 2год     |
| 15.6 | CI: запуск `bun test` на кожен PR (Lovable hook)                                             | 30хв     |

**DoD:** `bun test` зелений, coverage 5 self-heal детекторів + agentRuntime + checkout = 100%.

---

## 🟠 Sprint 16 — i18n Expansion (1 день)

**Ціль:** PL ринок реальний. Хоча б UI переклад.

| #    | Задача                                                                                           | Estimate |
| ---- | ------------------------------------------------------------------------------------------------ | -------- |
| 16.1 | Скрипт автоперекладу `src/lib/i18n/uk.json` → `pl.json` через Lovable AI (gemini-2.5-flash-lite) | 1год     |
| 16.2 | Manual review pl.json (тільки storefront-критичних ключів: cart, checkout, order, account)       | 3год     |
| 16.3 | Додати `pl` у `LanguageSwitcher` + tenant default_locale enum                                    | 30хв     |
| 16.4 | Storefront `s.$slug.tsx` — підхопити `tenant.default_locale` як initial                          | 30хв     |

**DoD:** storefront повністю польською для тенанта з `default_locale='pl'`.

---

## 🔮 Backlog (поза Q2)

- WooCommerce connector (схожий на Shopify, але REST + consumer key/secret)
- Rozetka Marketplace API
- Marketplace агентів (3rd party nodes) — потребує SDK + sandbox
- Bootstrap-флоу для нових тенантів (auto-detect industry → preset insights)
- Mobile app (React Native) для Owner — push на P0 incidents

---

## 📊 Health Snapshot (на момент створення)

✅ **Сильно:**

- Self-healing шар (5 детекторів, engine, apply/revert)
- Lead-gen pipeline (5 hunters + composer + ROI)
- Платіжний шар (LiqPay + Mono + WayForPay з HMAC)
- agentRuntime єдиний паттерн для 105 агентів
- i18n системно через `useT()`

⚠️ **Слабо:**

- 0 тестів на 50K+ LOC
- 3 stub-сторінки в brand area
- Немає customer account
- Лише DNTrade як зовнішній комерс-конектор
- Секрети в git history (потребує rotation, не лише `git rm`)

---

## 🎯 Послідовність виконання

```
Sprint 12 (security)  ─┐
                       ├─→ Sprint 13 (pages) ─→ Sprint 14 (Shopify) ─→ Sprint 16 (PL)
Sprint 15 (tests)     ─┘                                ↑
                                                  паралельно з 14
```

**Recommended next:** Sprint 12 (1-2 години роботи) — закрити security debt перед усім іншим.
