-- ============================================
-- ACOS Stack Phase 1: Full MFD-equivalent infrastructure
-- 20 tables to support 45 generalized agents
-- ============================================

-- 1. PRODUCT ECONOMICS
CREATE TABLE public.product_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cost_cents integer NOT NULL DEFAULT 0,
  shipping_cost_cents integer NOT NULL DEFAULT 0,
  fulfillment_cost_cents integer NOT NULL DEFAULT 0,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_costs_tenant_product ON public.product_costs(tenant_id, product_id);

-- 2. CUSTOMER LTV & CHURN
CREATE TABLE public.customer_ltv_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  predicted_ltv_cents integer NOT NULL DEFAULT 0,
  predicted_orders_12m integer NOT NULL DEFAULT 0,
  churn_probability numeric NOT NULL DEFAULT 0,
  churn_reason text,
  cac_cents integer,
  ltv_cac_ratio numeric,
  segment text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, customer_id)
);
CREATE INDEX idx_ltv_tenant_segment ON public.customer_ltv_scores(tenant_id, segment);
CREATE INDEX idx_ltv_churn ON public.customer_ltv_scores(tenant_id, churn_probability);

-- 3. CUSTOMER SEGMENTS
CREATE TABLE public.customer_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  segment_key text NOT NULL,
  name text NOT NULL,
  description text,
  rules jsonb NOT NULL DEFAULT '{}',
  customer_count integer NOT NULL DEFAULT 0,
  avg_ltv_cents integer NOT NULL DEFAULT 0,
  is_auto_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, segment_key)
);

-- 4. CUSTOMER COHORTS
CREATE TABLE public.customer_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cohort_month date NOT NULL,
  customer_count integer NOT NULL DEFAULT 0,
  retention_curve jsonb NOT NULL DEFAULT '[]',
  revenue_curve jsonb NOT NULL DEFAULT '[]',
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, cohort_month)
);

-- 5. CART RECOVERY ATTEMPTS
CREATE TABLE public.cart_recovery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  session_id text,
  cart_value_cents integer NOT NULL DEFAULT 0,
  cart_items jsonb NOT NULL DEFAULT '[]',
  abandoned_at timestamptz NOT NULL DEFAULT now(),
  attempt_number integer NOT NULL DEFAULT 1,
  channel text NOT NULL DEFAULT 'email',
  outbound_message_id uuid,
  recovered boolean NOT NULL DEFAULT false,
  recovered_at timestamptz,
  recovered_revenue_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cart_recovery_tenant ON public.cart_recovery_attempts(tenant_id, abandoned_at DESC);

-- 6. PRICING DECISIONS (audit trail beyond ai_actions)
CREATE TABLE public.pricing_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  agent text NOT NULL,
  old_price_cents integer NOT NULL,
  new_price_cents integer NOT NULL,
  reason text NOT NULL,
  elasticity_estimate numeric,
  expected_margin_lift_pct numeric,
  expected_volume_lift_pct numeric,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  measured_revenue_lift_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pricing_decisions_product ON public.pricing_decisions(tenant_id, product_id, applied_at DESC);

-- 7. PRICE ELASTICITY MODELS
CREATE TABLE public.price_elasticity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  elasticity numeric NOT NULL DEFAULT -1.0,
  confidence numeric NOT NULL DEFAULT 0.5,
  sample_size integer NOT NULL DEFAULT 0,
  optimal_price_cents integer,
  data_window_days integer NOT NULL DEFAULT 30,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, product_id)
);

-- 8. ORDER FRAUD SIGNALS
CREATE TABLE public.order_fraud_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  risk_score numeric NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '[]',
  flagged boolean NOT NULL DEFAULT false,
  reviewed boolean NOT NULL DEFAULT false,
  reviewer_decision text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fraud_tenant_flagged ON public.order_fraud_signals(tenant_id, flagged);

-- 9. PRODUCT BUNDLES
CREATE TABLE public.product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  product_ids uuid[] NOT NULL DEFAULT '{}',
  bundle_price_cents integer NOT NULL DEFAULT 0,
  individual_price_cents integer NOT NULL DEFAULT 0,
  affinity_score numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_auto_generated boolean NOT NULL DEFAULT false,
  agent text,
  times_purchased integer NOT NULL DEFAULT 0,
  revenue_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 10. PRODUCT AFFINITY (co-purchase matrix)
CREATE TABLE public.product_affinity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_a_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_b_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  co_purchase_count integer NOT NULL DEFAULT 0,
  lift_score numeric NOT NULL DEFAULT 1.0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, product_a_id, product_b_id)
);

-- 11. PROMOTIONS
CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  promo_type text NOT NULL DEFAULT 'percent_off',
  value numeric NOT NULL DEFAULT 0,
  applies_to_product_ids uuid[] DEFAULT '{}',
  applies_to_segment text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  usage_limit integer,
  times_used integer NOT NULL DEFAULT 0,
  revenue_cents integer NOT NULL DEFAULT 0,
  cost_cents integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  agent text,
  fatigue_score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_promotions_tenant_active ON public.promotions(tenant_id, is_active);

-- 12. AB TESTS
CREATE TABLE public.ab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  test_key text NOT NULL,
  variants jsonb NOT NULL DEFAULT '[]',
  metric text NOT NULL DEFAULT 'conversion_rate',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  winner_variant text,
  results jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, test_key)
);

-- 13. CONTENT PERFORMANCE (blog/landing/SEO)
CREATE TABLE public.content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  content_type text NOT NULL DEFAULT 'page',
  body_md text,
  seo_title text,
  seo_description text,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  agent_generated boolean NOT NULL DEFAULT false,
  agent text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

CREATE TABLE public.content_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.content_pages(id) ON DELETE CASCADE,
  url text NOT NULL,
  measured_on date NOT NULL DEFAULT CURRENT_DATE,
  views integer NOT NULL DEFAULT 0,
  unique_visitors integer NOT NULL DEFAULT 0,
  avg_time_on_page_seconds integer NOT NULL DEFAULT 0,
  bounce_rate numeric NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  search_clicks integer NOT NULL DEFAULT 0,
  search_impressions integer NOT NULL DEFAULT 0,
  search_position numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, url, measured_on)
);
CREATE INDEX idx_content_perf_tenant_date ON public.content_performance(tenant_id, measured_on DESC);

-- 14. SEARCH QUERIES (intent mining)
CREATE TABLE public.search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  query text NOT NULL,
  source text NOT NULL DEFAULT 'internal',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  result_count integer,
  clicked boolean NOT NULL DEFAULT false,
  led_to_purchase boolean NOT NULL DEFAULT false,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_queries_tenant_query ON public.search_queries(tenant_id, query);

-- 15. CHANNEL ATTRIBUTION
CREATE TABLE public.channel_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  touchpoints jsonb NOT NULL DEFAULT '[]',
  first_touch_channel text,
  last_touch_channel text,
  attribution_model text NOT NULL DEFAULT 'last_touch',
  attributed_revenue jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 16. NOTIFICATIONS / OWNER FEED
CREATE TABLE public.owner_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text,
  link text,
  metadata jsonb NOT NULL DEFAULT '{}',
  is_read boolean NOT NULL DEFAULT false,
  channel text NOT NULL DEFAULT 'in_app',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_tenant_unread ON public.owner_notifications(tenant_id, is_read, created_at DESC);

-- 17. DAILY DIGESTS / MORNING BRIEFS
CREATE TABLE public.daily_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  digest_date date NOT NULL,
  summary text NOT NULL,
  highlights jsonb NOT NULL DEFAULT '[]',
  metrics jsonb NOT NULL DEFAULT '{}',
  recommended_actions jsonb NOT NULL DEFAULT '[]',
  delivered_at timestamptz,
  delivered_channels text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, digest_date)
);

-- 18. INVENTORY FORECAST
CREATE TABLE public.inventory_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  forecast_for_date date NOT NULL,
  predicted_demand integer NOT NULL DEFAULT 0,
  predicted_stockout_at timestamptz,
  recommended_reorder_qty integer NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0.5,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, product_id, forecast_for_date)
);

-- 19. AGENT CONFLICTS (resolver log)
CREATE TABLE public.agent_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conflicting_action_ids uuid[] NOT NULL DEFAULT '{}',
  conflict_type text NOT NULL,
  resolution text NOT NULL DEFAULT 'pending',
  winning_action_id uuid,
  reason text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 20. LEARNING LOOP MONITORING
CREATE TABLE public.agent_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  measured_on date NOT NULL DEFAULT CURRENT_DATE,
  runs_total integer NOT NULL DEFAULT 0,
  runs_failed integer NOT NULL DEFAULT 0,
  insights_created integer NOT NULL DEFAULT 0,
  insights_approved integer NOT NULL DEFAULT 0,
  insights_dismissed integer NOT NULL DEFAULT 0,
  measured_revenue_lift_cents integer NOT NULL DEFAULT 0,
  health_score numeric NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, agent_id, measured_on)
);

-- 21. SOCIAL PROOF EVENTS
CREATE TABLE public.social_proof_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  display_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 22. UGC / REVIEWS
CREATE TABLE public.ugc_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'review',
  rating integer,
  body text,
  media_urls text[] DEFAULT '{}',
  is_approved boolean NOT NULL DEFAULT false,
  is_featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- ENABLE RLS ON ALL NEW TABLES
-- ============================================
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_ltv_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_recovery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_elasticity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_fraud_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_affinity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_proof_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ugc_items ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES (uniform pattern: tenant member read, super_admin write)
-- ============================================

-- Helper macro: each table gets:
--   * SELECT for tenant members + super_admin
--   * UPDATE for tenant admin + super_admin
--   * DELETE for super_admin only
-- INSERT is service-role only (agents write via supabaseAdmin).
-- Public-facing tables (social_proof, content_pages, ugc_items approved) get extra public read.

-- product_costs
CREATE POLICY product_costs_select ON public.product_costs FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY product_costs_update ON public.product_costs FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY product_costs_delete ON public.product_costs FOR DELETE TO authenticated
  USING (is_super_admin());

-- customer_ltv_scores
CREATE POLICY ltv_select ON public.customer_ltv_scores FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY ltv_delete ON public.customer_ltv_scores FOR DELETE TO authenticated
  USING (is_super_admin());

-- customer_segments
CREATE POLICY segments_select ON public.customer_segments FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY segments_update ON public.customer_segments FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY segments_delete ON public.customer_segments FOR DELETE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id));

-- customer_cohorts
CREATE POLICY cohorts_select ON public.customer_cohorts FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY cohorts_delete ON public.customer_cohorts FOR DELETE TO authenticated
  USING (is_super_admin());

-- cart_recovery_attempts
CREATE POLICY cart_recovery_select ON public.cart_recovery_attempts FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY cart_recovery_delete ON public.cart_recovery_attempts FOR DELETE TO authenticated
  USING (is_super_admin());

-- pricing_decisions
CREATE POLICY pricing_dec_select ON public.pricing_decisions FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY pricing_dec_delete ON public.pricing_decisions FOR DELETE TO authenticated
  USING (is_super_admin());

-- price_elasticity
CREATE POLICY elasticity_select ON public.price_elasticity FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY elasticity_delete ON public.price_elasticity FOR DELETE TO authenticated
  USING (is_super_admin());

-- order_fraud_signals
CREATE POLICY fraud_select ON public.order_fraud_signals FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY fraud_update ON public.order_fraud_signals FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY fraud_delete ON public.order_fraud_signals FOR DELETE TO authenticated
  USING (is_super_admin());

-- product_bundles (public read for active)
CREATE POLICY bundles_public_read ON public.product_bundles FOR SELECT TO anon, authenticated
  USING (is_active = true OR is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY bundles_update ON public.product_bundles FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY bundles_delete ON public.product_bundles FOR DELETE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id));

-- product_affinity
CREATE POLICY affinity_select ON public.product_affinity FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY affinity_delete ON public.product_affinity FOR DELETE TO authenticated
  USING (is_super_admin());

-- promotions (public read for active)
CREATE POLICY promotions_public_read ON public.promotions FOR SELECT TO anon, authenticated
  USING ((is_active = true AND (ends_at IS NULL OR ends_at > now())) OR is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY promotions_update ON public.promotions FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY promotions_delete ON public.promotions FOR DELETE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id));

-- ab_tests
CREATE POLICY ab_select ON public.ab_tests FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY ab_update ON public.ab_tests FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY ab_delete ON public.ab_tests FOR DELETE TO authenticated
  USING (is_super_admin());

-- content_pages (public read for published)
CREATE POLICY content_pages_public_read ON public.content_pages FOR SELECT TO anon, authenticated
  USING (is_published = true OR is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY content_pages_update ON public.content_pages FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY content_pages_delete ON public.content_pages FOR DELETE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id));

-- content_performance
CREATE POLICY content_perf_select ON public.content_performance FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY content_perf_delete ON public.content_performance FOR DELETE TO authenticated
  USING (is_super_admin());

-- search_queries
CREATE POLICY search_q_select ON public.search_queries FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY search_q_insert_public ON public.search_queries FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY search_q_delete ON public.search_queries FOR DELETE TO authenticated
  USING (is_super_admin());

-- channel_attribution
CREATE POLICY attribution_select ON public.channel_attribution FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY attribution_delete ON public.channel_attribution FOR DELETE TO authenticated
  USING (is_super_admin());

-- owner_notifications (user-scoped)
CREATE POLICY notif_select ON public.owner_notifications FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id) OR user_id = auth.uid());
CREATE POLICY notif_update ON public.owner_notifications FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id) OR user_id = auth.uid())
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id) OR user_id = auth.uid());
CREATE POLICY notif_delete ON public.owner_notifications FOR DELETE TO authenticated
  USING (is_super_admin() OR user_id = auth.uid());

-- daily_digests
CREATE POLICY digests_select ON public.daily_digests FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY digests_delete ON public.daily_digests FOR DELETE TO authenticated
  USING (is_super_admin());

-- inventory_forecasts
CREATE POLICY forecasts_select ON public.inventory_forecasts FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY forecasts_delete ON public.inventory_forecasts FOR DELETE TO authenticated
  USING (is_super_admin());

-- agent_conflicts
CREATE POLICY conflicts_select ON public.agent_conflicts FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY conflicts_update ON public.agent_conflicts FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY conflicts_delete ON public.agent_conflicts FOR DELETE TO authenticated
  USING (is_super_admin());

-- agent_health
CREATE POLICY health_select ON public.agent_health FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY health_delete ON public.agent_health FOR DELETE TO authenticated
  USING (is_super_admin());

-- social_proof_events (public read)
CREATE POLICY social_proof_public_read ON public.social_proof_events FOR SELECT TO anon, authenticated
  USING ((is_active = true AND (expires_at IS NULL OR expires_at > now())) OR is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY social_proof_delete ON public.social_proof_events FOR DELETE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id));

-- ugc_items (public read approved)
CREATE POLICY ugc_public_read ON public.ugc_items FOR SELECT TO anon, authenticated
  USING (is_approved = true OR is_super_admin() OR is_tenant_member(tenant_id));
CREATE POLICY ugc_insert_public ON public.ugc_items FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY ugc_update ON public.ugc_items FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
CREATE POLICY ugc_delete ON public.ugc_items FOR DELETE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id));

-- ============================================
-- TRIGGERS for updated_at
-- ============================================
CREATE TRIGGER trg_product_costs_updated BEFORE UPDATE ON public.product_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ltv_updated BEFORE UPDATE ON public.customer_ltv_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_segments_updated BEFORE UPDATE ON public.customer_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cart_rec_updated BEFORE UPDATE ON public.cart_recovery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_elasticity_updated BEFORE UPDATE ON public.price_elasticity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bundles_updated BEFORE UPDATE ON public.product_bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_promotions_updated BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ab_updated BEFORE UPDATE ON public.ab_tests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_content_pages_updated BEFORE UPDATE ON public.content_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();