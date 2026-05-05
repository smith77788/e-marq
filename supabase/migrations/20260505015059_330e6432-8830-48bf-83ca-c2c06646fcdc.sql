CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID,
  tenant_id UUID,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created ON public.audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log (actor_user_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_super_admin_read ON public.audit_log;
CREATE POLICY audit_log_super_admin_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS audit_log_tenant_member_read ON public.audit_log;
CREATE POLICY audit_log_tenant_member_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = audit_log.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    )
  );

-- Block all client-side writes; only triggers (SECURITY DEFINER) can insert.
DROP POLICY IF EXISTS audit_log_no_client_writes ON public.audit_log;
CREATE POLICY audit_log_no_client_writes ON public.audit_log
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- Generic trigger function
CREATE OR REPLACE FUNCTION public._audit_log_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_entity text := TG_ARGV[0];
  v_tenant uuid;
  v_entity_id text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_action := lower(TG_OP);
  IF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
    v_tenant := (v_after->>'tenant_id')::uuid;
    v_entity_id := COALESCE(v_after->>'id', '');
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    -- skip no-op updates
    IF v_before = v_after THEN RETURN NEW; END IF;
    v_tenant := (v_after->>'tenant_id')::uuid;
    v_entity_id := COALESCE(v_after->>'id', '');
  ELSE -- DELETE
    v_before := to_jsonb(OLD);
    v_tenant := (v_before->>'tenant_id')::uuid;
    v_entity_id := COALESCE(v_before->>'id', '');
  END IF;

  INSERT INTO public.audit_log (actor_user_id, tenant_id, entity_type, entity_id, action, before, after)
  VALUES (auth.uid(), v_tenant, v_entity, v_entity_id, v_action, v_before, v_after);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers (drop first if exist)
DROP TRIGGER IF EXISTS trg_audit_decision_queue ON public.decision_queue;
CREATE TRIGGER trg_audit_decision_queue
  AFTER INSERT OR UPDATE OR DELETE ON public.decision_queue
  FOR EACH ROW EXECUTE FUNCTION public._audit_log_capture('decision_queue');

DROP TRIGGER IF EXISTS trg_audit_tenant_integrations ON public.tenant_integrations;
CREATE TRIGGER trg_audit_tenant_integrations
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_integrations
  FOR EACH ROW EXECUTE FUNCTION public._audit_log_capture('tenant_integrations');

DROP TRIGGER IF EXISTS trg_audit_tenant_memberships ON public.tenant_memberships;
CREATE TRIGGER trg_audit_tenant_memberships
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public._audit_log_capture('tenant_memberships');

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public._audit_log_capture('user_roles');