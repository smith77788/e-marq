# Project Memory

## Core
ACOS = головний продукт: multi-tenant Autonomous Revenue OS для D2C-брендів.
Архітектура за зразком My Food Diary: ai_insights → orchestrator → 1-click apply → ai_memory feedback loop.
Storefront/Products/Orders = вторинна "commerce shell", не основа продукту.
ACOS-агенти живуть як TanStack server routes у src/routes/hooks/agents.*.ts (НЕ Supabase edge functions). pg_cron оркеструє їх через /hooks/agents/* і /hooks/engines/*.
Pure-SQL fallback layer (sql-insight-pipeline + auto-approval + measurement-loop + signal-layer + pilot-simulator) працює В БД — immune to cron 401/404, immune to Publish-затримок. Ця гілка лишається живою навіть коли всі hooks-агенти зомбі.
Telemetry pipeline: agentRuntime.startAgentRun → acos_agent_runs; HealthCheckAgent (hourly) агрегує у agent_health.
Auto-approval ЄДИНИЙ шлях: convert_insights_to_decisions (status=pending) → auto_approve_eligible_decisions (whitelist + history АБО bootstrap-cap=3 на (tenant,action_type) поки action_outcomes порожні). Legacy `propose_decisions_from_insights` ВИДАЛЕНА — вона ставила status='approved' напряму, обходячи policy і guardrails. owner_setup_task/owner_review/flag_for_review лишаються manual за дизайном. Approval mode tagged у `payload.approval_mode` = 'history' | 'bootstrap'.
Executor (execute_pending_decisions) має ВЛАСНИЙ whitelist `_is_in_db_safe_action()` — додавати туди кожен новий auto-approvable action_type, інакше approved застрягне. ЗАБОРОНЕНО додавати owner_setup_task/owner_review/owner_review_rules/flag_for_review — вони manual-by-design.
Executor НЕ створює baseline action_outcome — це робить тільки measure_pending_outcomes() коли настає час. Інакше виходить забруднений 7d-baseline без attributed_revenue_cents.
Measurement gating: ОБИДВІ функції (measure_pending_outcomes + demo_measure_recent_outcomes) пропускають decisions з executed_at < 24h ago — інакше actual_window дуже маленьке (хвилини) проти baseline_window 72h → 100% false-negatives і фейкові "9% win-rate". Production version 'adaptive_pre_vs_post_split' (cron 6h), demo 'pre3d_vs_post_normalized'.
First pilot tenant = MFD-like синтетичний 90-day dataset. Pilot tagged via tenants.is_pilot=true. Daily simulator + lift generator закривають learning loop.
Перед діагностикою агентів ЗАВЖДИ перевіряти `net._http_response.status_code` (не лише cron.job_run_details — там "succeeded" буває і на 404).
ВАЖЛИВО: `net._http_response.status_code = NULL` AND `timed_out=true` означає що pg_net 5s default timeout рветься — НЕ проблема endpoint, а cron command без `timeout_milliseconds`. Усі 36 HTTP-cron jobs мають `timeout_milliseconds := 30000` (rolled out 2026-05-04). Будь-який новий cron з net.http_post ОБОВ'ЯЗКОВО має включати цей параметр.
Cron б'є по prod URL `e-marq.lovable.app` — новий hooks-агент не працює до Publish.
Cron auth = `CRON_SECRET` (src/lib/acos/cronAuth.ts). Rolled out 2026-05-04: CRON_SECRET set, CRON_ALLOW_ANON=false, all 36 HTTP-cron jobs шлють Bearer CRON_SECRET. Anon-key fallback ЗАКРИТИЙ. Будь-який новий cron job ОБОВ'ЯЗКОВО має використовувати CRON_SECRET у Authorization header (інакше 401).
Cron-fan-out pattern: hook без `tenant_id`/`action_id` → перевіряти isCronToken і fan-out по active tenants. Інакше cron 400 → агенти зомбі. Застосовано до run-all, engines/dispatch, outreach-action-executor.
Executor cron-команди (outreach/tg-user) обгорнуті у `IF EXISTS pending THEN net.http_post`, щоб не бити endpoint впусту і не плодити 400 "no_action_id". outreach_actions allowed status: pending_review/approved/rejected/posted/failed/skipped (НЕ 'archived').
Stale-cleanup: archive_stale_outreach_actions() переводить >3d pending_review → 'skipped' щогодини у тому ж executor cron.
Pilot-noise guard: tg_notify_owner_on_new_paid_order() пропускає замовлення якщо payment_method='manual' АБО tenants.is_pilot=true. tg_notify_owner_on_notification() ТАКОЖ skip pilot tenants (інакше basic-food pilot генерував 580 high-severity notif/h → 10 Telegram повідомлень/хв owner-у). Pilot decisions/insights все ще видно в /brand/decisions UI, лише Telegram-канал заглушено. Self-heal `detectOrdersStuck` ТАКОЖ skip pilot tenants — синтетичні pending orders постійно >48h і генерували BLOCK-spam у Decision Inbox кожні 5 хв.
Self-heal engine dedup: `runSelfHealCycle` для decision != 'apply' пропускає persistAction якщо для (incident, kind, decision) вже є запис ≤24h назад. Інакше high-risk incidents (orders_stuck → block) плодять 200+ BLOCK рядків/добу. Allowed incident.status: open/fixing/fixed/blocked/monitoring/dismissed (НЕ 'suppressed').
Decision dedup: convert_insights_to_decisions() використовує `_decision_semantic_key_full(action_type, payload, insight_type, title)` — інакше insights з новим UUID щогодини плодять N копій того самого setup task у Decision Inbox. Ключ chain: payload.action → task_key → insight_type (payload або колонка) → product_id → customer_id → insight_id → normalized title. Перед INSERT перевіряє відкриті (pending/approved) decisions з тим же ключем для того ж tenant.
"Застрягла" decision_queue ≠ зламаний pipeline. Перед діагностикою перевірити `check_pipeline_health()` (cron `pipeline-health-check-hourly` :37, пише agent_health['sql_pipeline'] tenant_id=NULL). Semantic dedup + auto_approval_policy.max_age_hours=24h роблять "стару чергу pending" нормальним станом, особливо для pilot tenants з synthetic даними.
Адмін-функції для cron diagnostics: admin_list_cron_jobs() (OUT params: out_jobname, out_schedule, out_command, out_last_run_started, out_last_run_status, out_runs_50, out_successes_50), admin_cron_job_runs(jobname,n), admin_set_cron_job_command(jobname,cmd), admin_repair_cron_auth(token). Доступ: super_admin OR service_role OR postgres OR authenticated. Бекдор для service_role: `_diag_cron_jobs()` (jobname, schedule, command, active).
Tenant status enum: 'active','suspended','archived','pending'. Для fan-out беремо ('active','pending').
v1.0 Roadmap: Phase 1-7 (DONE) → Phase 8 Pilot simulator with real lift (DONE) → Phase 9 Auto-approval policy (DONE 2026-04-29: pending→approved→done без owner click для whitelisted дій з історією успіху).
Реальність 2026-05-04: pure-SQL гілка повністю автономна, всі 36 HTTP-cron jobs з 30s timeout + CRON_SECRET, pipeline-health-guard hourly моніторить застій.

## Memories
- [Agent network topology](mem://architecture/agent-network) — ~115 hooks-агентів, оркестрація через pg_cron, реєстр запусків
- [Cron deploy trap](mem://architecture/cron-deploy-trap) — як відрізнити реальний 200 від 404, чек-лист публікації нових агентів
- [Cron secret rollout](mem://security/cron-secret-rollout) — owner-action чек-ліст: додати CRON_SECRET, оновити cron jobs, ротація Telegram token
- [Reality audit 2026-Q2](mem://architecture/reality-audit-2026q2) — live agent/table inventory, drop list, що тримати у v1.0
- [Signal layer + decision loop](mem://architecture/signal-layer) — product/customer/funnel metrics, decision_queue, action_outcomes, refresh functions, cron schedule
- [Owner notifications](mem://features/owner-notifications) — тригер-pipeline decision_queue → owner_notifications → owner_telegram_outbox → cron drain
- [Owner Decision Inbox](mem://features/owner-decision-inbox) — /brand/decisions UI + owner_approve_decision / owner_reject_decision RPCs; куди ведуть Telegram-нотифікації
- [Measurement loop closure](mem://architecture/measurement-loop) — measure_pending_outcomes() + demo варіант, cron 6h, фіксує action_outcomes
- [Measurement attribution](mem://architecture/measurement-attribution) — proportional split: tenant-delta / N done-actions у ±3d вікні; виправляє ×N overcounting
- [SQL-driven insight pipeline](mem://architecture/sql-insight-pipeline) — generate_data_driven_insights(): stockout/low-stock/dead-stock/vip-silent, cron 1h, dedup_bucket=md5→bigint
- [Pilot simulator](mem://architecture/pilot-simulator) — synthetic baseline + lift orders for pilot tenants, daily cron 02:17 UTC, payment_method='manual', filter on customer_email
- [Auto-approval policy](mem://features/auto-approval) — whitelisted action_types + per-tenant success history → approved автоматично, cron 15min
- [Auto-pause policy on quality drop](mem://features/auto-pause-policy) — SQL agent #17, daily 06:30, disable auto_approval_policy коли action_quality_drop фіксується ≥2 ISO-тижнів за 28d; owner notif Telegram, dedup 7d. Завершує self-correcting loop.
- [Cohort Retention Engine](mem://features/cohort-retention-engine) — SQL agent #18, daily 03:45, compute_customer_cohorts() UPSERT 12 міс × 12 retention/revenue curves; JOIN orders by lower(customer_email); OUT params=out_tenant_id/out_cohorts_written
- [SQL pipeline tick](mem://architecture/sql-loop-tick) — convert+approve+execute+measure cron 30min; semantic dedup + max_age_hours=24h роблять "стару чергу" нормою; check_pipeline_health() guard hourly
- [Pure-SQL agent health](mem://features/pure-sql-agent-health) — compute_agent_health_daily() UPSERT у agent_health з 2 partial UNIQUE indexes (NULL tenant_id), cron hourly
- [pg_cron fan-out workaround](mem://architecture/cron-fanout-workaround) — обхід неопублікованих fan-out fix через SELECT FROM tenants у cron command; застосовано до run-all + engines/dispatch
- [Shopify webhook receiver](mem://features/shopify-webhook) — HMAC-SHA256 inbound на /api/public/integrations/inbound/shopify; читає rawBody один раз для HMAC + JSON.parse; topic→entity mapping; payload-адаптер для single-entity Shopify payloads
- [Audit log](mem://features/audit-log) — public.audit_log + DEFINER-тригери на decision_queue/integrations/memberships/user_roles; RLS super_admin + own-tenant; UI /admin/audit-log
- Reality 2026-05-05: попередній "64/74 zombies" застарів. Cron audit показав: 54 jobs, всі succeed окрім compute-forecast-calibration-daily (FIXED — round() type cast); 401-rate ~2.5% від загального трафіку; pure-SQL і HTTP-cron гілки обидві живі.
- Tests: vitest 2 + jsdom встановлено. Конфіг vitest.config.ts (alias @ → src). Перший smoke test src/lib/acos/cronAuth.test.ts. Запуск: bun test.
- [Realtime Revenue Pulse](mem://features/realtime-revenue-pulse) — 24h live sparkline на /brand під CockpitHero, Supabase Realtime subscribe orders postgres_changes, pulse-glow + liveDelta лічильник на новий paid order
- [CAC Payback Agent](mem://features/cac-payback-agent) — SQL agent #20, daily 04:35 + hourly :42; acquisition_costs × customer_cohorts → cac_payback_metrics; emits cac_payback_slow / cac_winner_channel; UI heatmap у /brand/roi
- [Notification digest dedup](mem://features/notification-digest) — notify_owner_telegram() батчить notifications того ж kind у 60min-вікні (batched_count + last 3 titles)
