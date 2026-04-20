-- ============================================================
-- ACOS Foundation: ai_insights, ai_memory, ai_actions, acos_agent_runs
-- ============================================================

-- 1. ai_insights — universal approval queue
CREATE TABLE public.ai_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  insight_type text NOT NULL,
  affected_layer text,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  expected_impact text,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_review','approved','rejected','applied','reverted')),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_bucket bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_insights_tenant_status_created ON public.ai_insights (tenant_id, status, created_at DESC);
CREATE INDEX idx_ai_insights_tenant_type_dedup ON public.ai_insights (tenant_id, insight_type, dedup_bucket);
CREATE INDEX idx_ai_insights_tenant_layer ON public.ai_insights (tenant_id, affected_layer);

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_insights_select_tenant_or_super ON public.ai_insights
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY ai_insights_update_tenant_admin ON public.ai_insights
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY ai_insights_delete_super_only ON public.ai_insights
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE TRIGGER trg_ai_insights_updated_at
  BEFORE UPDATE ON public.ai_insights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. ai_memory — per-tenant learning patterns
CREATE TABLE public.ai_memory (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pattern_key text NOT NULL,
  agent text NOT NULL,
  category text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  avg_impact numeric NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  learned_rule text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, pattern_key)
);

CREATE INDEX idx_ai_memory_tenant_agent ON public.ai_memory (tenant_id, agent);
CREATE INDEX idx_ai_memory_tenant_active ON public.ai_memory (tenant_id, is_active);

ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_memory_select_tenant_or_super ON public.ai_memory
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY ai_memory_delete_super_only ON public.ai_memory
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE TRIGGER trg_ai_memory_updated_at
  BEFORE UPDATE ON public.ai_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. ai_actions — applied/reverted action log for feedback loop
CREATE TABLE public.ai_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_insight_id uuid REFERENCES public.ai_insights(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  agent_id text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_impact text,
  actual_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','reverted','failed')),
  target_entity text,
  target_id uuid,
  applied_at timestamptz,
  measured_at timestamptz,
  reverted_at timestamptz,
  reverted_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_actions_tenant_status ON public.ai_actions (tenant_id, status, created_at DESC);
CREATE INDEX idx_ai_actions_source_insight ON public.ai_actions (source_insight_id);
CREATE INDEX idx_ai_actions_tenant_agent ON public.ai_actions (tenant_id, agent_id);

ALTER TABLE public.ai_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_actions_select_tenant_or_super ON public.ai_actions
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY ai_actions_update_tenant_admin ON public.ai_actions
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY ai_actions_delete_super_only ON public.ai_actions
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE TRIGGER trg_ai_actions_updated_at
  BEFORE UPDATE ON public.ai_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. acos_agent_runs — agent health monitoring
CREATE TABLE public.acos_agent_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success','failure','skipped')),
  error text,
  insights_created integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX idx_acos_agent_runs_tenant_agent_started ON public.acos_agent_runs (tenant_id, agent_id, started_at DESC);
CREATE INDEX idx_acos_agent_runs_tenant_status ON public.acos_agent_runs (tenant_id, status, started_at DESC);

ALTER TABLE public.acos_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY acos_agent_runs_select_tenant_or_super ON public.acos_agent_runs
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY acos_agent_runs_delete_super_only ON public.acos_agent_runs
  FOR DELETE TO authenticated
  USING (public.is_super_admin());