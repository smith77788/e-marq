-- Universal helper: deny user-driven writes for system tables
-- (service_role bypasses RLS, so internal jobs still work).

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'acos_agent_runs','agent_conflicts','agent_health',
    'ai_actions','ai_insights','ai_memory',
    'balance_ledger','cart_recovery_attempts','channel_attribution',
    'customer_cohorts','customer_ltv_scores','customer_segments',
    'daily_digests','decision_policies','dntrade_health_log','dntrade_sync_errors',
    'inventory_forecasts','order_fraud_signals',
    'content_performance','content_pages','social_proof_events',
    'product_affinity','product_bundles','promotions',
    'outbound_messages','owner_notifications','owner_telegram_outbox',
    'plan_change_log','tenant_balances','tenant_invitations',
    'tenant_subscriptions','tenant_usage_counters','telegram_chat_routing',
    'plans','ab_tests','conversations','order_items'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Skip if table doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = tbl) THEN
      CONTINUE;
    END IF;

    -- INSERT policy: only super_admin (service_role bypasses RLS anyway)
    EXECUTE format($f$
      DROP POLICY IF EXISTS "%I_sysinsert_block" ON public.%I;
      CREATE POLICY "%I_sysinsert_block"
        ON public.%I FOR INSERT TO authenticated
        WITH CHECK (public.is_super_admin());
    $f$, tbl, tbl, tbl, tbl);

    -- UPDATE policy (if not already covered): super_admin only
    EXECUTE format($f$
      DROP POLICY IF EXISTS "%I_sysupdate_block" ON public.%I;
      CREATE POLICY "%I_sysupdate_block"
        ON public.%I FOR UPDATE TO authenticated
        USING (public.is_super_admin())
        WITH CHECK (public.is_super_admin());
    $f$, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- order_items needs special: tenant admins can insert (via place_storefront_order — service role)
-- but to be safe, also allow tenant admins for manual order management
DROP POLICY IF EXISTS "order_items_sysinsert_block" ON public.order_items;
CREATE POLICY "order_items_admin_insert"
ON public.order_items FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- product_bundles: tenant admins can manage bundles
DROP POLICY IF EXISTS "product_bundles_sysinsert_block" ON public.product_bundles;
CREATE POLICY "product_bundles_admin_insert"
ON public.product_bundles FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "product_bundles_sysupdate_block" ON public.product_bundles;
CREATE POLICY "product_bundles_admin_update"
ON public.product_bundles FOR UPDATE TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- content_pages: tenant admins manage their pages
DROP POLICY IF EXISTS "content_pages_sysinsert_block" ON public.content_pages;
CREATE POLICY "content_pages_admin_insert"
ON public.content_pages FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- promotions: tenant admins
DROP POLICY IF EXISTS "promotions_sysinsert_block" ON public.promotions;
CREATE POLICY "promotions_admin_insert"
ON public.promotions FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "promotions_sysupdate_block" ON public.promotions;
CREATE POLICY "promotions_admin_update"
ON public.promotions FOR UPDATE TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));