CREATE TABLE public.ingest_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  tenant_slug_attempted text,
  status_code int NOT NULL,
  error_code text NOT NULL,
  error_message text,
  request_body jsonb,
  request_ip text,
  user_agent text,
  origin text,
  event_type_attempted text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingest_error_logs_tenant_created ON public.ingest_error_logs (tenant_id, created_at DESC);
CREATE INDEX idx_ingest_error_logs_created ON public.ingest_error_logs (created_at DESC);
CREATE INDEX idx_ingest_error_logs_status ON public.ingest_error_logs (status_code, created_at DESC);

ALTER TABLE public.ingest_error_logs ENABLE ROW LEVEL SECURITY;

-- Super admin can see all
CREATE POLICY "ingest_logs_select_super_admin"
  ON public.ingest_error_logs FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- Tenant members can see their tenant's logs
CREATE POLICY "ingest_logs_select_tenant_member"
  ON public.ingest_error_logs FOR SELECT
  TO authenticated
  USING (tenant_id IS NOT NULL AND is_tenant_member(tenant_id));

-- No INSERT/UPDATE/DELETE policies => only service_role can write