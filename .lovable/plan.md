## Швидкий фікс затримок Telegram-бота (Варіант A)

Робимо мінімальну зміну: бот опитує Telegram **щохвилини** замість раз на 2 хв, і не "висить" даремно після того, як cron уже відрубав з'єднання.

### Що міняємо

**1. Cron job** — `marq-telegram-poll-2min` → `marq-telegram-poll-1min`
- Розклад: `* * * * *` (щохвилини)
- `timeout_milliseconds := 35000` (давати pg_net 35с замість дефолтних 30с)
- Auth: `Bearer CRON_SECRET` (як усі інші cron jobs)

**2. `src/lib/telegram/pollHelpers.ts`**
- `MAX_RUNTIME_MS = 25_000` (було 55_000) — щоб route завершувався ДО того, як pg_net вб'є з'єднання
- `MIN_REMAINING_MS = 5_000` (без змін)

**3. `src/routes/hooks/telegram.poll.ts`**
- `getUpdates timeout` обмежити до 20с: `Math.min(20, ...)` замість `Math.min(50, ...)`
- Це дозволяє циклу робити 1 виклик за прохід і коректно завершуватись у вікно 25с

**4. Memory** — оновити `mem://index.md` (рядок про polling) + створити `mem://features/telegram-polling.md`

### Чому це допоможе

```text
БУЛО:                              СТАЛО:
cron 2 хв ──┐                       cron 1 хв ──┐
            ▼ (30с timeout)                     ▼ (35с timeout)
route 55с ──X (kill on 30с)         route 25с ──✓ (finishes cleanly)
            └── 25с роботи          └── update_offset persisted
                втрачається             правильно
1 поллінг / 2 хв = max 2 хв lag    1 поллінг / 1 хв = max 1 хв lag
```

Реальна затримка відповіді бота впаде з 1-2 хв до 0-60с.

### Що НЕ робимо у цьому варіанті

- Webhook-режим (Варіант B) — потребує більшого рефакторингу: новий публічний endpoint, видалення `deleteWebhook` у polling-циклі, тестування через connector gateway. Лишаємо на потім, якщо 1 хв все ще буде замало.

Скажи "ок" — застосую.
