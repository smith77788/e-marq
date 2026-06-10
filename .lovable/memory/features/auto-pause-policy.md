---
name: Auto-Pause Policy on Quality Drop
description: SQL agent #17, daily 06:30, disables auto_approval_policy when action_quality_drop fires 2+ ISO weeks in 28d window; owner notif via Telegram, dedup 7d
type: feature
---

## Що робить

`auto_pause_policies_on_quality_drop()` — SECURITY DEFINER функція, що:

1. Сканує `ai_insights` з `insight_type='action_quality_drop'` за останні 28 днів
2. Групує по `metrics->>'action_type'`, рахує DISTINCT ISO-тижнів
3. Якщо ≥2 тижнів з drop → `UPDATE auto_approval_policy SET enabled=false` + audit note у `notes`
4. Шле owner_notification (kind='auto_paused_policy', severity=high, channel=telegram, tenant_id=NULL = super_admin scope)
5. Dedup: пропускає якщо нотифікація для цього action_type вже є за останні 7 днів

## Розклад

`30 6 * * *` (cron job `auto-pause-policy-daily`) — одразу після `action-quality-monitor` (06:15).

## Чому це закриває loop

Це **завершення v1.0 vision "Autonomous Revenue OS"**:

- `action_quality_monitor` (#16) → детектує деградацію
- `auto_pause_policy` (#17) → **автоматично** виключає з whitelist
- Owner отримує Telegram не "approve?", а "ось що я зробив, перевір правила якщо незгоден"

Causal-disable (Welch t-test) лишається паралельним суворим механізмом для high-confidence випадків. Quality-drop = early-warning на основі win-rate (м'якший, спрацьовує раніше).

## Re-enable

Owner вручну виставляє `enabled=true` через UI або SQL. Auto-pause не б'є повторно поки policy disabled.
