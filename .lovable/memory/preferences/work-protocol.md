---
name: MARQ V2 Work Protocol
description: Обов'язковий 7-крок цикл верифікації для кожного файлу MARQ. Read→Plan→Write→Check→Improve→Check→Deliver.
type: preference
---

# MARQ V2 Ultra-Precise Work Protocol

**Why:** користувач вимагає, щоб робота була ідеальна — з подвійною перевіркою, доопрацюванням і знову перевіркою. Не здавати результат, поки не ідеально.

**How to apply (для КОЖНОГО файлу і КОЖНОЇ зміни):**

1. **READ** — прочитай існуючий код, який буде зачеплений (cat/grep/code--view). Перевір реальні шляхи імпортів.
2. **PLAN** — продумай реалізацію. Знайди конфлікти з існуючим кодом. Перевір, чи не конфліктує нова таблиця/поле з існуючим.
3. **WRITE** — напиши код за існуючими патернами (agentRuntime, money, i18n, Supabase clients).
4. **CHECK #1** — TypeScript типи? Імпорти резолвяться? `tenant_id` фільтр у кожному запиті? RLS policies? Patterns дотримано?
5. **IMPROVE** — Що можна спростити? Зміцнити? Додати edge cases? Loading/error states?
6. **CHECK #2** — Перевір повністю ще раз. tsc чистий? UA + EN i18n додані? Mobile 375px? Money в cents?
7. **DELIVER** — Тільки тепер здавай результат.

Якщо на кроці 4 або 6 знайдеш помилку — повернись до 3. Не переходь до наступного файлу, поки поточний не пройшов всі 7 кроків.

**Self-checklist перед здачею:**

- TypeScript: 0 помилок, 0 `any`, всі імпорти валідні
- DB: `.eq("tenant_id", tenantId)` скрізь; `supabaseAdmin` лише в `hooks/`/`*.server.ts`; нові таблиці мають RLS + INDEX по tenant_id + updated_at trigger
- Patterns: agent → auth/start/try/finish/fail; компонент → Skeleton + error; усі рядки через `useT()`; нові ключі в обох мовах
- Security: платіжні ключі лише server; storefront RPC = SECURITY DEFINER
- UX: mobile responsive, sonner toast при мутаціях, loading кнопки

**Абсолютні заборони:**

- Не редагувати існуючі міграції — лише нові
- Не імпортувати `supabaseAdmin` в компоненти
- Не хардкодити tenant_id / secrets / API keys
- Не вводити нові UI бібліотеки (тільки radix/shadcn)
- Не виставляти платіжні ключі клієнту
- Не ламати Telegram flow, не видаляти DN Trade
- Не міняти `agentRuntime.ts` — лише імпортувати
- Не використовувати float для грошей — лише cents (integer)
