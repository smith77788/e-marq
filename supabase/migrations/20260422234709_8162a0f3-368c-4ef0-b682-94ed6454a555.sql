-- ============================================================
-- Sprint 20: Personal Telegram Account (MTProto) infrastructure
-- ============================================================

-- 1) Sessions (one active per tenant)
CREATE TABLE IF NOT EXISTS public.tg_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  user_id_tg BIGINT,
  username TEXT,
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending_code'
    CHECK (status IN ('pending_code','pending_2fa','active','revoked','error')),
  dc_id INTEGER,
  -- Encrypted session blob (AES-GCM via bridge). Stored as text (base64).
  encrypted_session TEXT,
  -- Temporary login data while flow is in progress (phone_code_hash, etc.)
  login_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  last_used_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- only one active session per tenant
CREATE UNIQUE INDEX IF NOT EXISTS tg_user_sessions_active_per_tenant
  ON public.tg_user_sessions (tenant_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS tg_user_sessions_tenant_idx
  ON public.tg_user_sessions (tenant_id, status);

ALTER TABLE public.tg_user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tg_sessions_admin_select" ON public.tg_user_sessions
  FOR SELECT USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
CREATE POLICY "tg_sessions_admin_insert" ON public.tg_user_sessions
  FOR INSERT WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
CREATE POLICY "tg_sessions_admin_update" ON public.tg_user_sessions
  FOR UPDATE USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
CREATE POLICY "tg_sessions_admin_delete" ON public.tg_user_sessions
  FOR DELETE USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE TRIGGER tg_user_sessions_touch
  BEFORE UPDATE ON public.tg_user_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Action queue
CREATE TABLE IF NOT EXISTS public.tg_user_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.tg_user_sessions(id) ON DELETE SET NULL,
  -- send_dm | send_comment | reaction | join_chat | leave_chat | edit_message | delete_message
  action_type TEXT NOT NULL CHECK (action_type IN
    ('send_dm','send_comment','reaction','join_chat','leave_chat','edit_message','delete_message')),
  -- Target identifiers (any of: chat_username/chat_id/user_id/message_id)
  target JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Payload: text, reaction emoji, etc.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- queued | running | done | failed | skipped | cancelled
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','skipped','cancelled')),
  origin TEXT NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual','agent','rule','bulk')),
  agent_id TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tg_user_actions_queue_idx
  ON public.tg_user_actions (status, scheduled_for) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS tg_user_actions_tenant_idx
  ON public.tg_user_actions (tenant_id, created_at DESC);

ALTER TABLE public.tg_user_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tg_actions_admin_select" ON public.tg_user_actions
  FOR SELECT USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
CREATE POLICY "tg_actions_admin_insert" ON public.tg_user_actions
  FOR INSERT WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
CREATE POLICY "tg_actions_admin_update" ON public.tg_user_actions
  FOR UPDATE USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
CREATE POLICY "tg_actions_admin_delete" ON public.tg_user_actions
  FOR DELETE USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE TRIGGER tg_user_actions_touch
  BEFORE UPDATE ON public.tg_user_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Safety quotas
CREATE TABLE IF NOT EXISTS public.tg_user_quotas (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Hard caps (per 24h window)
  max_dm_per_day INTEGER NOT NULL DEFAULT 30,
  max_comment_per_day INTEGER NOT NULL DEFAULT 50,
  max_reaction_per_day INTEGER NOT NULL DEFAULT 200,
  max_join_per_day INTEGER NOT NULL DEFAULT 10,
  -- Hourly burst caps
  max_dm_per_hour INTEGER NOT NULL DEFAULT 8,
  max_comment_per_hour INTEGER NOT NULL DEFAULT 12,
  max_reaction_per_hour INTEGER NOT NULL DEFAULT 60,
  -- Per-action delay range (seconds) — humanises behaviour
  delay_min_seconds INTEGER NOT NULL DEFAULT 12,
  delay_max_seconds INTEGER NOT NULL DEFAULT 90,
  -- Auto-pause if too many failures
  auto_pause_after_errors INTEGER NOT NULL DEFAULT 5,
  -- Allow agents to act autonomously (vs only manual)
  agent_autonomy_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  agent_max_per_day INTEGER NOT NULL DEFAULT 20,
  paused_until TIMESTAMPTZ,
  paused_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tg_user_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tg_quotas_admin_all" ON public.tg_user_quotas
  FOR ALL USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE TRIGGER tg_user_quotas_touch
  BEFORE UPDATE ON public.tg_user_quotas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Append-only audit log
CREATE TABLE IF NOT EXISTS public.tg_user_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_id UUID REFERENCES public.tg_user_actions(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  target JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  origin TEXT,
  agent_id TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tg_user_action_log_tenant_idx
  ON public.tg_user_action_log (tenant_id, created_at DESC);

ALTER TABLE public.tg_user_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tg_log_admin_select" ON public.tg_user_action_log
  FOR SELECT USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- 5) Helper: count actions in window
CREATE OR REPLACE FUNCTION public.tg_user_count_actions(
  _tenant_id UUID,
  _action_type TEXT,
  _window_minutes INTEGER
) RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(COUNT(*), 0)::int
  FROM public.tg_user_action_log
  WHERE tenant_id = _tenant_id
    AND action_type = _action_type
    AND status = 'done'
    AND created_at > now() - make_interval(mins => _window_minutes);
$$;