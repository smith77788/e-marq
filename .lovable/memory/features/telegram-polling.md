---
name: Telegram polling cadence
description: Shared bot polling cron schedule + route runtime caps to keep response latency under 1 minute
type: feature
---

Cron `marq-telegram-poll-1min` (`* * * * *`, timeout 35s) б'є по `/hooks/telegram/poll`.

`pollHelpers.MAX_RUNTIME_MS = 25_000` (route виходить ДО pg_net kill на ~30с).
`telegram.poll.ts` getUpdates `timeout = min(20, ...)` — 1 long-poll за прохід вкладається у 25с-вікно і коректно зберігає `update_offset`.

Не повертати >25с runtime або >20с getUpdates timeout: pg_net обриває з'єднання → `update_offset` не персистується → дублікати/пропуски апдейтів.

Якщо потрібна суб-секундна реакція — переходити на webhook (`setWebhook` → `/api/public/telegram/webhook`), а не зменшувати інтервал нижче 1 хв.
