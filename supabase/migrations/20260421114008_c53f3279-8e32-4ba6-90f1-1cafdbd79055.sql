-- DN Trade (and future) integration storage per tenant
CREATE TABLE public.tenant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  credentials_encrypted text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  synced_products_count integer NOT NULL DEFAULT 0,
  synced_customers_count integer NOT NULL DEFAULT 0,
  synced_orders_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE INDEX idx_tenant_integrations_tenant ON public.tenant_integrations(tenant_id);
CREATE INDEX idx_tenant_integrations_active ON public.tenant_integrations(is_active) WHERE is_active = true;

ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_integrations_super_admin_all"
  ON public.tenant_integrations FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "tenant_integrations_admin_select"
  ON public.tenant_integrations FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id));

CREATE POLICY "tenant_integrations_admin_insert"
  ON public.tenant_integrations FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "tenant_integrations_admin_update"
  ON public.tenant_integrations FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "tenant_integrations_admin_delete"
  ON public.tenant_integrations FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));

CREATE TRIGGER trg_tenant_integrations_updated
  BEFORE UPDATE ON public.tenant_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add SKU index on products to speed up upserts during sync
CREATE INDEX IF NOT EXISTS idx_products_tenant_sku ON public.products(tenant_id, sku) WHERE sku IS NOT NULL;

-- Index to speed up customer dedup-by-email during sync
CREATE INDEX IF NOT EXISTS idx_customers_tenant_email_lower
  ON public.customers(tenant_id, lower(email)) WHERE email IS NOT NULL;