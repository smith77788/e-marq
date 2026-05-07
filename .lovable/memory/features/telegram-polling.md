---
name: Telegram bot transport (webhook + polling fallback)
description: Telegram-бот працює у webhook-режимі; polling route і cron лишаються як аварійний rollback
type: feature
---

## Активний режим: webhook

- Endpoint: `POST /api/public/telegram/webhook` (`src/routes/api/public/telegram.webhook.ts`)
- Auth: header `X-Telegram-Bot-Api-Secret-Token` має дорівнювати `sha256("telegram-webhook:" + TELEGRAM_API_KEY).base64url`
- Idempotency: PK на `telegram_processed_updates.update_id`. Дублікат → 200 OK без обробки
- Завжди повертає 200 (інакше Telegram ретраїть до 24 год). Помилки логуються через `console.error`
- Cleanup: `cleanup_telegram_processed_updates()` у cron `marq-telegram-cleanup-processed` (03:17 UTC, керує сама БД)
- Latency: <1с (push), `getUpdates` 502 більше не релевантні

## setWebhook (одноразово після Publish)

```bash
SECRET=$(node -e "console.log(require('crypto').createHash('sha256').update('telegram-webhook:' + process.env.TELEGRAM_API_KEY).digest('base64url'))")
curl -sS 'https://connector-gateway.lovable.dev/telegram/setWebhook' \
  -H "Authorization: Bearer $LOVABLE_API_KEY" \
  -H "X-Connection-Api-Key: $TELEGRAM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"https://e-marq.lovable.app/api/public/telegram/webhook\",\"secret_token\":\"$SECRET\",\"allowed_updates\":[\"message\",\"callback_query\"],\"drop_pending_updates\":false}"
```

Verify: `getWebhookInfo` → `pending_update_count: 0`, `url` правильний.

## Rollback на polling (emergency)

1. `deleteWebhook` через connector gateway
2. У SQL:
   ```sql
   SELECT cron.schedule(
     'marq-telegram-poll-1min', '* * * * *',
     $$ SELECT net.http_post(
       url:='https://e-marq.lovable.app/hooks/telegram/poll',
       headers:=('{"Content-Type":"application/json","Authorization":"Bearer '||current_setting('app.cron_secret', true)||'"}')::jsonb,
       body:='{}'::jsonb,
       timeout_milliseconds:=35000
     ); $$
   );
   ```
3. УВАГА: `telegram.poll.ts` БІЛЬШЕ НЕ викликає `deleteWebhook` автоматично — це навмисно, щоб випадковий запуск polling не стирав активний webhook. Якщо повертаєтесь на polling — зніміть webhook вручну ПЕРШИМ.

## Чому НЕ polling

- Min latency 0–60с навіть з cron 1хв; webhook = <1с
- Long-poll щохвилини = 1440 викликів конектор-gateway/добу проти ~подій-в-день
- 502 на `getUpdates` (Telegram gateway) — постійний шум у логах
