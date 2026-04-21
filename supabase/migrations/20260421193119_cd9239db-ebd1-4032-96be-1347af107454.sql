-- 1. customers: tenant members can insert/update (e.g. checkout creates a customer)
CREATE POLICY "customers_member_insert"
ON public.customers FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "customers_member_update"
ON public.customers FOR UPDATE TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- 2. product_costs: tenant admins
CREATE POLICY "product_costs_admin_insert"
ON public.product_costs FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 3. pricing_decisions: tenant admins
CREATE POLICY "pricing_decisions_admin_insert"
ON public.pricing_decisions FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY "pricing_decisions_admin_update"
ON public.pricing_decisions FOR UPDATE TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 4. price_elasticity: tenant admins
CREATE POLICY "price_elasticity_admin_insert"
ON public.price_elasticity FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY "price_elasticity_admin_update"
ON public.price_elasticity FOR UPDATE TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 5. events: tighten — authenticated must be tenant member OR be guest tracking via JS (no user_id)
DROP POLICY IF EXISTS "events_insert_authenticated" ON public.events;
CREATE POLICY "events_insert_authenticated"
ON public.events FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = events.tenant_id AND t.status = 'active')
  AND (
    public.is_tenant_member(events.tenant_id)
    OR (events.user_id = auth.uid() AND events.session_id IS NOT NULL)
  )
);

-- 6. search_queries: tenant member only
DROP POLICY IF EXISTS "search_queries_insert_authenticated_only" ON public.search_queries;
CREATE POLICY "search_queries_insert_member"
ON public.search_queries FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin() OR public.is_tenant_member(tenant_id)
);

-- 7. owner_notifications: tighten 'notif_insert'
DROP POLICY IF EXISTS "notif_insert" ON public.owner_notifications;
CREATE POLICY "owner_notifications_insert_member"
ON public.owner_notifications FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin() OR public.is_tenant_member(tenant_id)
);