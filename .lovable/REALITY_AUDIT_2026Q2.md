# Reality Audit — 2026-04-29

Snapshot of what's **actually** alive in production vs what just exists as schema.
Use this as the source of truth for the v1.0 refactor (NOT the inflated bot/agent counts in the investor brief).

---

## 1. Agents (acos_agent_runs, last 14 days)

74 distinct `agent_id` values produced rows. **Most stopped running on 2026-04-21.**
Only 9 agents have a `last_run` after 2026-04-21:

| Agent                      | Last run   | Status                |
| -------------------------- | ---------- | --------------------- |
| `tick`                     | 2026-04-28 | ✅ alive (per-minute) |
| `integration_scout`        | 2026-04-26 | ✅ alive              |
| `catalog_enricher`         | 2026-04-26 | ✅ alive              |
| `brand_profile_discoverer` | 2026-04-26 | ✅ alive              |
| `channel_discovery`        | 2026-04-26 | ✅ alive              |
| `data_gap_auditor`         | 2026-04-26 | ✅ alive              |
| `seasonality_detector`     | 2026-04-26 | ✅ alive              |
| `margin_estimator`         | 2026-04-26 | ✅ alive              |
| `customer_voice_miner`     | 2026-04-26 | ✅ alive              |
| `onboarding_coach`         | 2026-04-24 | ⚠️ stale              |

The other **64 agents have not produced a run since 2026-04-21**. They're not dead in code — they're dead because **pg_cron is failing auth** (see §3).

### Reliability red flags

- `inventory-forecast`: 8 runs / 7 errors → 87% failure rate even when it ran.
- `tick`: only 3 successful runs in 14 days even though it's scheduled every minute (most invocations 401).

---

## 2. Database tables (real row counts, all 98 public tables)

| Bucket                    | Count | Notes                               |
| ------------------------- | ----- | ----------------------------------- |
| **CORE alive** (≥10 rows) | 21    | commerce + telemetry + outreach     |
| **THIN** (1–9 rows)       | 33    | partial config / single-tenant data |
| **DEAD** (0 rows)         | 44    | 45% of the schema is empty          |

### CORE alive (21)

`self_heal_actions` (594), `acos_agent_runs` (554), `balance_ledger` (385), `events` (378), `dntrade_health_log` (300), `orders` (124), `outreach_leads` (110), `channel_attribution` (82), `order_items` (75), `order_fraud_signals` (73), `owner_telegram_outbox` (47), `ai_insights` (45), `customers` (36), `customer_ltv_scores` (26), `bootstrap_facts` (25), `owner_notifications` (23), `import_jobs` (19), `outreach_settings` (18), `outbound_messages` (11), `ai_actions` (11), `products` (10).

### DEAD (0 rows) — drop or freeze

- **Loyalty stack** (3): `loyalty_accounts`, `loyalty_programs`, `loyalty_transactions`
- **Email pipeline** (5): `email_campaigns`, `email_campaign_recipients`, `email_events`, `email_sends`, `email_suppressions`
- **Telegram user layer** (5): `tg_user_actions`, `tg_user_action_log`, `tg_user_quotas`, `tg_user_sessions`, `telegram_owner_pairings`
- **Pricing experiments** (3): `pricing_decisions`, `price_elasticity`, `ab_tests`
- **Commerce dark branch** (5): `product_variants`, `product_costs`, `product_images`, `product_bundles`, `collections`, `collection_products`
- **Other** (~22): `cart_recovery_attempts`, `restock_notifications`, `restock_subscribe_rate_limit`, `payment_intents`, `payment_callbacks_log`, `topup_requests`, `inventory_forecasts`, `agent_conflicts`, `agent_permissions`, `admin_permissions`, `lead_prospects`, `lead_outreach`, `outreach_metrics`, `content_performance`, `dntrade_sync_errors`, `integration_rate_limits`, `tenant_api_keys`, `import_field_mappings`, `search_queries`, `ugc_items`, `user_preferences`, `product_affinity`.

Many of these have **no producer** (no INSERT path in the codebase) — they were created speculatively for future agents. Confirming-via-code-search is part of Phase 2 cleanup.

---

## 3. Cron health (net.\_http_response, last 24h)

| status  | count   | meaning                                                           |
| ------- | ------- | ----------------------------------------------------------------- |
| 200     | 369     | OK                                                                |
| **401** | **360** | `{"error":"Unauthorized"}` — stale `apikey` header in pg_cron     |
| 400     | 120     | `tenant_id required` (96), `no_action_id` (24) — body shape drift |
| 403     | 72      | `Forbidden` — non-cron handler                                    |
| 404     | 5       | hooks route not yet published                                     |

**Diagnosis**: ~1 401 per minute, stable for 12+ hours. This matches `tick` schedule. The most likely cause is that pg_cron jobs were registered with an old anon key (or with `apikey` header instead of `Authorization: Bearer`). `cronAuth.ts` accepts the current `SUPABASE_PUBLISHABLE_KEY` as a Bearer fallback, so rotating cron-job headers will fix it without needing CRON_SECRET first.

I can't `SELECT FROM cron.job` directly (permission denied for schema cron). Need a SECURITY DEFINER function to inspect/repair pg_cron from the app side.

---

## 4. v1.0 implications

Based on this audit, the **earlier "kill half the tables" plan from the user is correct and concrete**:

### KEEP (foundational)

- commerce: `products`, `orders`, `order_items`, `customers`
- telemetry: `acos_agent_runs`, `events`, `agent_health`, `self_heal_actions`, `self_heal_incidents`
- core ACOS: `ai_insights`, `ai_actions`, `ai_memory`, `bootstrap_facts`
- outreach (live): `outreach_leads`, `outreach_settings`, `outreach_actions`, `channel_attribution`, `customer_ltv_scores`
- billing: `balance_ledger`, `tenant_balances`, `tenant_usage_counters`, `plans`, `tenant_subscriptions`
- multi-tenant: `tenants`, `tenant_memberships`, `user_roles`, `tenant_configs`, `tenant_integrations`

### REWRITE (architecture)

- `ai_actions` → `action_queue` with explicit `pending|approved|executing|done|rejected` state machine
- `ai_insights` → add `confidence`, `expected_impact`, `derived_from_agent`, `expires_at`
- `ai_memory` → tie every entry to (insight_id, action_id, outcome) for closed loop
- ADD `decision_queue` (super-set of action_queue with batching & approval)
- ADD `action_outcomes` (post-hoc measurement of every executed action)
- ADD signal layer (next phase): `product_metrics_14d`, `customer_metrics_30d`, `funnel_metrics_14d`

### DROP (unused)

- All 44 DEAD tables listed above. Also drop their RLS policies, FKs, and any orphan code paths.
- Also: `customer_segments` is duplicated by `customer_cohorts`; pick one.

### FIX (urgent operational)

1. Repair pg_cron auth headers (need cron-inspect/repair RPC).
2. Drop `inventory-forecast` agent or fix the 87% error rate.
3. Re-enable the 64 frozen agents OR explicitly kill them — silent zombies are the worst state.

---

## 5. Next moves (Phase 3 entry)

1. Build `public.cron_jobs_admin` view via SECURITY DEFINER → see what URL/headers each pg_cron job uses.
2. Migration to **mass-update pg_cron jobs** to use a single `Authorization: Bearer <SUPABASE_PUBLISHABLE_KEY>` header (intermediate step before CRON_SECRET rollout).
3. Decide cull list (44 DEAD tables) — single migration that drops them all with proper FK cleanup.
4. Sketch `decision_queue` + `action_outcomes` schema — propose, then migrate.

---

_Author: Lovable agent. Run on 2026-04-29 against live Supabase project `igzcukhnarwezxwdyonn`._
