-- ============================================================
-- AGENT PERMISSIONS — per-tenant, per-agent runtime controls
-- ============================================================

CREATE TYPE public.agent_mode AS ENUM ('off', 'suggest', 'auto');
CREATE TYPE public.agent_risk_level AS ENUM ('low', 'medium', 'high');

CREATE TABLE public.agent_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  mode public.agent_mode NOT NULL DEFAULT 'suggest',
  auto_apply_max_risk public.agent_risk_level NOT NULL DEFAULT 'medium',
  notify_on_apply boolean NOT NULL DEFAULT true,
  weekly_run_limit integer NOT NULL DEFAULT 200,
  last_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_permissions_tenant_agent_uniq UNIQUE (tenant_id, agent_id)
);

CREATE INDEX idx_agent_permissions_tenant ON public.agent_permissions(tenant_id);

ALTER TABLE public.agent_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read agent permissions"
  ON public.agent_permissions FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_tenant_member(tenant_id)
  );

CREATE POLICY "members upsert agent permissions"
  ON public.agent_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_tenant_member(tenant_id)
  );

CREATE POLICY "members update agent permissions"
  ON public.agent_permissions FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_tenant_member(tenant_id)
  );

CREATE POLICY "service role manages agent permissions"
  ON public.agent_permissions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE TRIGGER agent_permissions_set_updated_at
  BEFORE UPDATE ON public.agent_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Helpers
-- ============================================================

-- Returns existing permission row OR safe defaults if none exists.
CREATE OR REPLACE FUNCTION public.get_agent_permission(
  _tenant_id uuid,
  _agent_id text
)
RETURNS TABLE (
  mode public.agent_mode,
  auto_apply_max_risk public.agent_risk_level,
  notify_on_apply boolean,
  weekly_run_limit integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(p.mode, 'suggest'::public.agent_mode) AS mode,
    COALESCE(p.auto_apply_max_risk, 'medium'::public.agent_risk_level) AS auto_apply_max_risk,
    COALESCE(p.notify_on_apply, true) AS notify_on_apply,
    COALESCE(p.weekly_run_limit, 200) AS weekly_run_limit
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.agent_permissions p
    ON p.tenant_id = _tenant_id AND p.agent_id = _agent_id
$$;

-- Returns true when the agent is allowed to auto-apply an action of given risk.
CREATE OR REPLACE FUNCTION public.can_auto_apply_action(
  _tenant_id uuid,
  _agent_id text,
  _risk public.agent_risk_level
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  perm record;
  risk_rank int;
  max_rank int;
BEGIN
  SELECT * INTO perm FROM public.get_agent_permission(_tenant_id, _agent_id);
  IF perm.mode <> 'auto' THEN
    RETURN false;
  END IF;
  risk_rank := CASE _risk WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 END;
  max_rank := CASE perm.auto_apply_max_risk WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 END;
  RETURN risk_rank <= max_rank;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_agent_permission(uuid, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_auto_apply_action(uuid, text, public.agent_risk_level) TO authenticated, anon, service_role;