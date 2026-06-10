---
name: Auto-Resume Policy on Recovery
description: SQL agent #18, daily 06:45 UTC, re-enables auto-paused auto_approval_policy when last 14d action_outcomes show recovery (n>=5, win-rate>=50%, avg attributed_revenue>0); 7d dedup
type: feature
---

## Що робить

`auto_resume_policies_on_recovery()` SECURITY DEFINER — закриває loop після `auto_pause_policies_on_quality_drop` (#17).

1. Сканує `auto_approval_policy WHERE enabled=false AND notes ILIKE '%auto-paused%'`.
2. Для кожної paused policy агрегує `action_outcomes` за останні 14 днів (по action_type, всі tenants).
3. Якщо n≥5 done, win-rate≥50%, avg attributed_revenue_cents>0 → `enabled=true` + audit note.
4. Шле owner_notification (kind='auto_resumed_policy', severity=info, channel=telegram, tenant_id=NULL).
5. Dedup 7 днів через перевірку owner_notifications.

## Розклад

`45 6 * * *` (cron job `auto-resume-policy-daily`) — після #16 (06:15) і #17 (06:30).

## Чому це безпечно

- quality_monitor (#16) і causal-disable лишаються активними. Якщо resume передчасний — paused знову за 1-2 тижні.
- Threshold 50% win-rate vs 30% pause-threshold у #17 → буферна зона.

## Owner re-enable

Owner все ще може вручну re-enable раніше через UI/SQL. Auto-resume тільки додає шлях для autonomous loop.
