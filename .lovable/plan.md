## Крок 1/3: Telegram Webhook Mode (Variant B)

Замінюємо long-polling на push-вебхук. Telegram сам шле апдейти на наш endpoint → реакція <1с замість 0–60с.

### Що робимо

**1. Новий публічний route** `src/routes/api/public/telegram.webhook.ts`
- POST handler приймає update від Telegram
- Перевіряє `X-Telegram-Bot-Api-Secret-Token` (HMAC-derived з `TELEGRAM_API_KEY`, як у docs)
- Викликає той самий `processMessage` / `processCallback` з `pollHelpers.ts`
- Завжди повертає 200 OK швидко (інакше Telegram буде ретраїти)
- Idempotency через `update_id` UNIQUE на `telegram_bot_state` або dedup-таблицю

**2. `setWebhook` через connector gateway**
- Реєструємо URL: `https://e-marq.lovable.app/api/public/telegram/webhook`
- `secret_token` = `sha256("telegram-webhook:" + TELEGRAM_API_KEY).base64url`
- `allowed_updates: ["message", "callback_query"]`

**3. Polling cron вимикаємо** (НЕ видаляємо код — як fallback)
- `cron.unschedule('marq-telegram-poll-1min')`
- `telegram.poll.ts` route лишається для emergency rollback (`deleteWebhook` + reschedule cron)
- Memory оновлюємо з планом rollback

**4. Memory update**
- `mem://features/telegram-polling.md` → `mem://features/telegram-webhook.md`
- Index: рядок про polling cadence → webhook + fallback procedure

### Чому безпечно

- Webhook signature перевіряється HMAC'ом → нікого стороннього не пустимо
- Polling код лишається → можна повернутися за 1 SQL команду
- Той самий `processMessage` → бізнес-логіка не змінюється, ризик регресу мінімальний

### Ризики

- Якщо `e-marq.lovable.app` тимчасово 5xx → Telegram ретраїть до ~24h, апдейти не губляться
- `setWebhook` робиться одноразово вручну (через `code--exec` curl) — якщо забудемо, бот мовчить

### Що НЕ робимо у цьому кроці

- Пункт 2 (502 retry/backoff) — після webhook це стає безпредметним, getUpdates більше не викликаємо
- Пункт 3 (інші roadmap items) — окремо після завершення webhook

Скажи "ок" — ставлю.
