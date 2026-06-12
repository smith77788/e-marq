-- ============================================================================
-- Performance: indexes for hot storefront/agent query paths
-- ============================================================================
-- Verified audit findings (performance domain, apply-now):
--   - TopCustomers / storefront leaderboards order customers by total_spent_cents
--     within a tenant; no index on (tenant_id, total_spent_cents DESC) existed.
--   - bot-sequences and other agents scan conversations by (tenant_id, created_at)
--     over a 7-day window; only a (tenant_id, direction, created_at) index existed,
--     which the planner can't use for the direction-agnostic scan.
-- Both are additive CREATE INDEX IF NOT EXISTS — safe and idempotent.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_customers_tenant_spent
  ON public.customers (tenant_id, total_spent_cents DESC)
  WHERE total_orders > 0;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_created
  ON public.conversations (tenant_id, created_at DESC);
