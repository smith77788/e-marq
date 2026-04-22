-- ============================================================
-- AUDIT V2 — Fix storage policy bug + lock down PII reads to admins
-- ============================================================

-- 1) Storage product_images_public_read: fix column shadowing bug
DROP POLICY IF EXISTS "product_images_public_read" ON storage.objects;
CREATE POLICY "product_images_public_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(storage.objects.name))[1] IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id::text = (storage.foldername(storage.objects.name))[1]
        AND t.status = 'active'
    )
  );

-- 2) customers — admins only for SELECT
DROP POLICY IF EXISTS "customers_select_tenant_or_super" ON public.customers;
CREATE POLICY "customers_select_admin_or_super" ON public.customers
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 3) email_sends — admins only for SELECT
DROP POLICY IF EXISTS "email_sends_member_read" ON public.email_sends;
CREATE POLICY "email_sends_admin_read" ON public.email_sends
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 4) email_campaign_recipients — admins only for SELECT
DROP POLICY IF EXISTS "campaign_recipients_member_read" ON public.email_campaign_recipients;
CREATE POLICY "campaign_recipients_admin_read" ON public.email_campaign_recipients
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 5) loyalty_accounts — admins only for SELECT
DROP POLICY IF EXISTS "loyalty_accounts_member_read" ON public.loyalty_accounts;
CREATE POLICY "loyalty_accounts_admin_read" ON public.loyalty_accounts
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 6) restock_notifications — admins only for SELECT
DROP POLICY IF EXISTS "restock_member_read" ON public.restock_notifications;
CREATE POLICY "restock_admin_read" ON public.restock_notifications
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 7) conversations — admins only for SELECT
DROP POLICY IF EXISTS "conversations_select_tenant_or_super" ON public.conversations;
CREATE POLICY "conversations_select_admin_or_super" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 8) outbound_messages — admins only for SELECT
DROP POLICY IF EXISTS "outbound_select_tenant_or_super" ON public.outbound_messages;
CREATE POLICY "outbound_select_admin_or_super" ON public.outbound_messages
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 9) customer_ltv_scores — admins only for SELECT
DROP POLICY IF EXISTS "ltv_select" ON public.customer_ltv_scores;
CREATE POLICY "ltv_select_admin" ON public.customer_ltv_scores
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 10) product_costs — admins only for SELECT
DROP POLICY IF EXISTS "product_costs_select" ON public.product_costs;
CREATE POLICY "product_costs_select_admin" ON public.product_costs
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 11) order_fraud_signals — admins only for SELECT
DROP POLICY IF EXISTS "fraud_select" ON public.order_fraud_signals;
CREATE POLICY "fraud_select_admin" ON public.order_fraud_signals
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 12) payment_intents — admins only for SELECT
DROP POLICY IF EXISTS "payment_intents_member_read" ON public.payment_intents;
CREATE POLICY "payment_intents_admin_read" ON public.payment_intents
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 13) tenant_configs — drop the broad member_read policy.
--     Keeps the existing admin-only policy in place.
DROP POLICY IF EXISTS "tenant_configs_member_read" ON public.tenant_configs;

-- 14) orders — admins or the customer themselves only
DROP POLICY IF EXISTS "orders_select_tenant_or_customer_or_super" ON public.orders;
CREATE POLICY "orders_select_admin_or_customer_or_super" ON public.orders
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_tenant_admin(tenant_id)
    OR (customer_user_id = auth.uid())
  );

-- 15) collection_products_anon_read — only when the collection is active
DROP POLICY IF EXISTS "collection_products_anon_read" ON public.collection_products;
CREATE POLICY "collection_products_anon_read" ON public.collection_products
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_products.collection_id
        AND c.is_active = true
    )
  );