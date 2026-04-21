CREATE TABLE public.import_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.tenant_integrations(id) ON DELETE SET NULL,
  source_provider TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'manual',
  entity_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  rows_failed INTEGER NOT NULL DEFAULT 0,
  error_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_jobs_tenant ON public.import_jobs(tenant_id, created_at DESC);
CREATE INDEX idx_import_jobs_integration ON public.import_jobs(integration_id);
CREATE INDEX idx_import_jobs_status ON public.import_jobs(status);

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_jobs_admin_select ON public.import_jobs
  FOR SELECT TO authenticated USING (is_tenant_admin(tenant_id));
CREATE POLICY import_jobs_admin_insert ON public.import_jobs
  FOR INSERT TO authenticated WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY import_jobs_admin_update ON public.import_jobs
  FOR UPDATE TO authenticated USING (is_tenant_admin(tenant_id));
CREATE POLICY import_jobs_admin_delete ON public.import_jobs
  FOR DELETE TO authenticated USING (is_tenant_admin(tenant_id));

CREATE TABLE public.import_field_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.tenant_integrations(id) ON DELETE CASCADE,
  source_provider TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_mappings_tenant ON public.import_field_mappings(tenant_id, source_provider, entity_kind);

ALTER TABLE public.import_field_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_mappings_admin_select ON public.import_field_mappings
  FOR SELECT TO authenticated USING (is_tenant_admin(tenant_id));
CREATE POLICY import_mappings_admin_insert ON public.import_field_mappings
  FOR INSERT TO authenticated WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY import_mappings_admin_update ON public.import_field_mappings
  FOR UPDATE TO authenticated USING (is_tenant_admin(tenant_id));
CREATE POLICY import_mappings_admin_delete ON public.import_field_mappings
  FOR DELETE TO authenticated USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trg_import_mappings_updated_at
  BEFORE UPDATE ON public.import_field_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();