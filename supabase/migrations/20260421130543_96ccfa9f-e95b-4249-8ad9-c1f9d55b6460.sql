
ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS webhook_secret text;

CREATE TABLE IF NOT EXISTS public.dntrade_sync_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.tenant_integrations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('products','customers','orders','webhook')),
  external_id text,
  message text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dntrade_sync_errors_tenant ON public.dntrade_sync_errors(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_dntrade_sync_errors_kind ON public.dntrade_sync_errors(kind);

ALTER TABLE public.dntrade_sync_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dntrade_errors_super_all"
  ON public.dntrade_sync_errors FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "dntrade_errors_admin_select"
  ON public.dntrade_sync_errors FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id));
