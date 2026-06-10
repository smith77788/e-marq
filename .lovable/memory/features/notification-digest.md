---
name: Notification digest dedup
description: notify_owner_telegram() batches notifications of the same kind within 60min into single Telegram message (batched_count + last 3 titles)
type: feature
---

**Problem:** один tenant може згенерувати 5+ owner_notifications того ж kind (high/critical) за хвилини → 5 окремих Telegram повідомлень, owner ігнорує.

**Solution:** `notify_owner_telegram(_tenant, _kind, _source_id)` для `_kind='notification'`:

1. Шукає pending row у owner_telegram_outbox для (tenant, source_kind='notification') з тим самим `payload->>'notif_kind'` створений <60min тому.
2. Якщо знайшов → UPDATE: `batched_count++`, append title до `batched_titles` (jsonb array). НЕ створює новий outbox row, НЕ викликає http_post (cron drain підбере з останнім станом).
3. Якщо немає → INSERT новий з `payload = {notif_kind, batched_count: 1, batched_titles: [title]}`.

**Render side** (`telegram.notify-owner.ts → renderNotification`): якщо batched_count > 1 → header "{brand} · {kind} · N нових" + bullet list з last 3 titles замість title+body.

**Не зачіпає** insight/action source_kinds — для них кожен decision/insight = окремий actionable card з власними buttons.
