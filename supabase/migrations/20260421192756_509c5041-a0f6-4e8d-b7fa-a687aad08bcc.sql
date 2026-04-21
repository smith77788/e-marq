-- Restore tenant-scoped SELECT for products
CREATE POLICY "products_tenant_members_select"
ON public.products
FOR SELECT
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- Restore tenant-scoped SELECT for product_bundles
CREATE POLICY "bundles_tenant_members_select"
ON public.product_bundles
FOR SELECT
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- tenant_configs: обмежити SELECT тільки адмінами (tenant_id містить owner Telegram chat ID)
DROP POLICY IF EXISTS "tenant_configs_select_members" ON public.tenant_configs;
DROP POLICY IF EXISTS "Tenant members can read configs" ON public.tenant_configs;
DROP POLICY IF EXISTS "configs_select_members" ON public.tenant_configs;

CREATE POLICY "tenant_configs_admins_only_select"
ON public.tenant_configs
FOR SELECT
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));