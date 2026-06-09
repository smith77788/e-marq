-- Add missing indexes on foreign-key columns that agents query frequently.
-- Without these, every JOIN on these columns causes a full table scan.

CREATE INDEX IF NOT EXISTS idx_outbound_messages_related_product
  ON public.outbound_messages (related_product_id)
  WHERE related_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_affinity_product_a
  ON public.product_affinity (product_a_id);

CREATE INDEX IF NOT EXISTS idx_product_affinity_product_b
  ON public.product_affinity (product_b_id);

CREATE INDEX IF NOT EXISTS idx_content_performance_page
  ON public.content_performance (page_id)
  WHERE page_id IS NOT NULL;

-- Also add index on ai_insights.dedup_key for faster dedup lookups in insertInsightsDedup()
CREATE INDEX IF NOT EXISTS idx_ai_insights_tenant_dedup
  ON public.ai_insights (tenant_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Index for decision_queue expiry cleanup
CREATE INDEX IF NOT EXISTS idx_decision_queue_status_expires
  ON public.decision_queue (status, expires_at)
  WHERE status IN ('pending', 'approved');

-- Index for cart_recovery_attempts lookup by session (used by cart-recovery agent)
CREATE INDEX IF NOT EXISTS idx_cart_recovery_attempts_session
  ON public.cart_recovery_attempts (session_id);

-- Index for loyalty_transactions lookup by order (used in place_storefront_order)
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_order
  ON public.loyalty_transactions (order_id)
  WHERE order_id IS NOT NULL;
