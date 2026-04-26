-- ============================================================================
-- Self-Healing Engine: incidents, actions, settings
-- ============================================================================

CREATE TABLE public.self_heal_incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inc_code TEXT NOT NULL,
  tenant_id UUID NULL,
  detector TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('p0','p1','p2','p3')),
  title TEXT NOT NULL,
  root_cause TEXT NULL,
  scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  regression_risk TEXT NOT NULL DEFAULT 'low' CHECK (regression_risk IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixing','fixed','blocked','monitoring','dismissed')),
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_self_heal_incidents_fingerprint_open
  ON public.self_heal_incidents(fingerprint)
  WHERE status IN ('open','fixing','monitoring');
CREATE INDEX idx_self_heal_incidents_status ON public.self_heal_incidents(status);
CREATE INDEX idx_self_heal_incidents_severity ON public.self_heal_incidents(severity);
CREATE INDEX idx_self_heal_incidents_tenant ON public.self_heal_incidents(tenant_id);
CREATE INDEX idx_self_heal_incidents_last_seen ON public.self_heal_incidents(last_seen_at DESC);

CREATE SEQUENCE public.self_heal_inc_seq START 1;

CREATE OR REPLACE FUNCTION public.self_heal_assign_inc_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.inc_code IS NULL OR NEW.inc_code = '' THEN
    NEW.inc_code := 'INC-' || LPAD(nextval('public.self_heal_inc_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_self_heal_assign_inc_code
  BEFORE INSERT ON public.self_heal_incidents
  FOR EACH ROW EXECUTE FUNCTION public.self_heal_assign_inc_code();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname='update_updated_at_column' AND pronamespace='public'::regnamespace
  ) THEN
    CREATE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $f$ LANGUAGE plpgsql SET search_path = public;
  END IF;
END $$;

CREATE TRIGGER trg_self_heal_incidents_updated_at
  BEFORE UPDATE ON public.self_heal_incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.self_heal_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  incident_id UUID NULL REFERENCES public.self_heal_incidents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('apply','propose','block','monitor')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  revert_payload JSONB NULL,
  reversible BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','reverted','failed','skipped')),
  applied_at TIMESTAMPTZ NULL,
  applied_by UUID NULL,
  reverted_at TIMESTAMPTZ NULL,
  reverted_by UUID NULL,
  result_text TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_self_heal_actions_incident ON public.self_heal_actions(incident_id);
CREATE INDEX idx_self_heal_actions_status ON public.self_heal_actions(status);
CREATE INDEX idx_self_heal_actions_kind ON public.self_heal_actions(kind);
CREATE INDEX idx_self_heal_actions_created ON public.self_heal_actions(created_at DESC);

CREATE TABLE public.self_heal_settings (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_self_heal_settings_updated_at
  BEFORE UPDATE ON public.self_heal_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.self_heal_settings (key, value, description) VALUES
  ('auto_heal_enabled', 'true'::jsonb, 'Master switch for autonomous fixes'),
  ('allowed_kinds',
   '["reschedule_outreach","reset_stuck_agent_run","kill_failing_agent","cleanup_expired_notifications","pause_unhealthy_channel"]'::jsonb,
   'Whitelist of action kinds that may be auto-applied'),
  ('severity_threshold', '"p2"'::jsonb, 'Auto-apply only for incidents with severity <= threshold'),
  ('dedupe_window_minutes', '60'::jsonb, 'Suppress duplicate auto-fixes for same fingerprint within window');

ALTER TABLE public.self_heal_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.self_heal_actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.self_heal_settings  ENABLE ROW LEVEL SECURITY;

-- RLS via existing public.is_super_admin() (no args; uses auth.uid() inside)
CREATE POLICY "Super admins read incidents"
  ON public.self_heal_incidents FOR SELECT TO authenticated
  USING (public.is_super_admin());
CREATE POLICY "Super admins write incidents"
  ON public.self_heal_incidents FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admins read actions"
  ON public.self_heal_actions FOR SELECT TO authenticated
  USING (public.is_super_admin());
CREATE POLICY "Super admins write actions"
  ON public.self_heal_actions FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admins read settings"
  ON public.self_heal_settings FOR SELECT TO authenticated
  USING (public.is_super_admin());
CREATE POLICY "Super admins write settings"
  ON public.self_heal_settings FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

ALTER PUBLICATION supabase_realtime ADD TABLE public.self_heal_incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.self_heal_actions;