---
name: SQL pipeline tick
description: Pure-SQL loop (insights→decisions→approve→execute→measure) і чому decision_queue може виглядати "застряглим" хоча здоровий
type: feature
---

# SQL pipeline tick (cron `sql-loop-tick-30min`)

`run_sql_loop_tick()` викликає по черзі:
1. `convert_insights_to_decisions()` — `status IN ('new','in_review')` → INSERT у decision_queue, потім ставить `status='applied'`
2. `auto_approve_eligible_decisions()` — whitelist + history АБО bootstrap
3. `execute_pending_decisions()` per tenant
4. `measure_pending_outcomes()` + `demo_measure_recent_outcomes()`

## Чому decision_queue може здаватись мертвим

**Це нормальна поведінка, НЕ баг:**

1. **Semantic dedup.** `convert_insights_to_decisions` через `_decision_semantic_key_full` блокує дублікати з відкритими (`pending`/`approved`) decisions для того ж tenant. Для insights без product_id/customer_id (типу `review_opportunity`) ключ = `insight_type` → ВСІ нові insights цього типу skip-аються поки одна `request_review` decision сидить pending.

2. **Auto-approval `max_age_hours`.** `auto_approval_policy.max_age_hours` (default 24h). Pending decisions старші за це автоматично ігноруються. Тому "застряглі" pending з минулого тижня НЕ будуть auto-approved — це by design.

3. **Pilot tenant без нових sales.** Synthetic data → ті самі semantic keys → dedup → нічого нового не з'являється у decision_queue. Це здорова поведінка.

## Health guard (cron `pipeline-health-check-hourly`)

`check_pipeline_health()` запускається о :37 щогодини, пише в `agent_health` (agent_id='sql_pipeline', tenant_id=NULL). Виявляє СПРАВЖНІ проблеми:
- `no_recent_insights`: max(ai_insights.created_at) < now() - 6h
- `converter_stuck`: count(status='new' AND created_at < 2h ago) > 5
- `auto_approval_missed`: >5 pending whitelisted decisions старших за `max_age_hours`
- `no_recent_outcomes`: max(action_outcomes.measured_at) < 48h ago

`health_score`: 1.0=healthy, 0.5=degraded, 0.0=failing. HealthCheckAgent читає `agent_health` і відправляє Telegram при failing.
