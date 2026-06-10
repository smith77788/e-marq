---
name: Owner Morning Brief (daily Telegram digest)
description: send_owner_daily_digest() будує narrative Markdown повідомлення о 08:00 UTC з історією за добу — час зекономлено, виручка 24h/30d, top win тижня, inbox breakdown з guardian counter і forecast потенціалом
type: feature
---

Cron `owner-daily-digest-08utc` (08:00 UTC) → `send_owner_daily_digest()`.

CRITICAL FIX (2026-04-29): попередня версія мала `t.tenant_id` (колонка не існує — `tenants.id`), падала тихо у cron. Виправлено: `tenants t JOIN tenant_configs tc ON tc.tenant_id = t.id`.

Skip правила:

- pilot tenants (`tenants.is_pilot=true`) — навмисно
- tenant без `tenant_configs.owner_telegram_chat_id`
- tenant з `done24=0 AND pending=0` (нічого розповідати)

Структура повідомлення:

1. Opener: "За минулу добу я виконав N автономних дій — це ~M год вашого часу" (8 хв/дія)
2. Revenue (24h + 30d з win-rate якщо measured>0; інакше "чекаємо вимірювання 24h gate")
3. Top win тижня (action_type/title + attributed_revenue з action_outcomes)
4. Inbox: total + 🛡️ guardian count (`payload ? 'auto_approval_skip_reason'`) + 💡 сумарний forecast.expected_revenue + breakdown по action_type (топ 5)
5. CTA: link `/brand/decisions?tenant=...`

Markdown via `parse_mode: 'Markdown'`, `disable_web_page_preview: true`.
