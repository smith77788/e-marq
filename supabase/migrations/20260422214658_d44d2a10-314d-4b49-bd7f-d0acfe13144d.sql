
-- ============================================================
-- OUTREACH HUNTER — port from Basic Food, adapted for MARQ multi-tenant
-- ============================================================

-- 1) outreach_leads: знайдені пости/користувачі
CREATE TABLE IF NOT EXISTS public.outreach_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('reddit','google','blog','telegram','instagram','other')),
  source_url TEXT NOT NULL,
  source_platform_id TEXT,
  author_handle TEXT,
  author_url TEXT,
  title TEXT,
  content TEXT NOT NULL,
  language TEXT DEFAULT 'uk',
  geo_country TEXT,
  geo_city TEXT,
  intent_score NUMERIC NOT NULL DEFAULT 0 CHECK (intent_score >= 0 AND intent_score <= 1),
  topic_tags TEXT[] NOT NULL DEFAULT '{}',
  matched_keywords TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','composing','queued','acted','rejected','duplicate','expired')),
  fingerprint TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_leads_tenant_fp_uniq ON public.outreach_leads(tenant_id, fingerprint);
CREATE INDEX IF NOT EXISTS outreach_leads_tenant_channel_idx ON public.outreach_leads(tenant_id, channel, status, discovered_at DESC);
CREATE INDEX IF NOT EXISTS outreach_leads_tenant_intent_idx ON public.outreach_leads(tenant_id, intent_score DESC, discovered_at DESC);

-- 2) outreach_actions: дії (драфт → пост)
CREATE TABLE IF NOT EXISTS public.outreach_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.outreach_leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('comment','reply','dm','post','share')),
  draft_text TEXT NOT NULL,
  draft_alt_text TEXT,
  tone TEXT DEFAULT 'helpful',
  utm_campaign TEXT NOT NULL,
  promo_code TEXT,
  landing_url TEXT NOT NULL,
  tribunal_case_id UUID,
  tribunal_verdict TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected','posted','failed','skipped')),
  posted_at TIMESTAMPTZ,
  posted_url TEXT,
  failed_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_actions_tenant_lead_idx ON public.outreach_actions(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS outreach_actions_tenant_status_idx ON public.outreach_actions(tenant_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS outreach_actions_tenant_channel_idx ON public.outreach_actions(tenant_id, channel, posted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_actions_utm_uniq ON public.outreach_actions(utm_campaign);

-- 3) outreach_metrics: ROI
CREATE TABLE IF NOT EXISTS public.outreach_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_id UUID NOT NULL REFERENCES public.outreach_actions(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.outreach_leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  add_to_cart INTEGER NOT NULL DEFAULT 0,
  orders_count INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  ctr NUMERIC NOT NULL DEFAULT 0,
  conversion_rate NUMERIC NOT NULL DEFAULT 0,
  roi_per_action NUMERIC NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_metrics_action_uniq ON public.outreach_metrics(action_id);
CREATE INDEX IF NOT EXISTS outreach_metrics_tenant_channel_idx ON public.outreach_metrics(tenant_id, channel, computed_at DESC);

-- 4) outreach_settings: per-tenant key/value
CREATE TABLE IF NOT EXISTS public.outreach_settings (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (tenant_id, key)
);

-- timestamp triggers
CREATE TRIGGER set_outreach_leads_updated_at
  BEFORE UPDATE ON public.outreach_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_outreach_actions_updated_at
  BEFORE UPDATE ON public.outreach_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_outreach_metrics_updated_at
  BEFORE UPDATE ON public.outreach_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_outreach_settings_updated_at
  BEFORE UPDATE ON public.outreach_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.outreach_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_settings ENABLE ROW LEVEL SECURITY;

-- Super admins manage everything; tenant members see only their own data
CREATE POLICY "outreach_leads_select" ON public.outreach_leads FOR SELECT
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "outreach_leads_modify" ON public.outreach_leads FOR ALL
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "outreach_actions_select" ON public.outreach_actions FOR SELECT
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "outreach_actions_modify" ON public.outreach_actions FOR ALL
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "outreach_metrics_select" ON public.outreach_metrics FOR SELECT
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "outreach_metrics_modify" ON public.outreach_metrics FOR ALL
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "outreach_settings_select" ON public.outreach_settings FOR SELECT
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "outreach_settings_modify" ON public.outreach_settings FOR ALL
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
