ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS min_order_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_per_customer INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  template TEXT NOT NULL,
  subject TEXT,
  resend_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  campaign_id UUID,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_sends_tenant ON public.email_sends(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_email ON public.email_sends(tenant_id, to_email);
CREATE INDEX IF NOT EXISTS idx_email_sends_msg ON public.email_sends(resend_message_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_template_created ON public.email_sends(tenant_id, template, created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  segment TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  opens_count INTEGER NOT NULL DEFAULT 0,
  clicks_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_tenant ON public.email_campaigns(tenant_id);
DROP TRIGGER IF EXISTS trg_email_campaigns_updated_at ON public.email_campaigns;
CREATE TRIGGER trg_email_campaigns_updated_at BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_events_msg ON public.email_events(resend_message_id);
CREATE INDEX IF NOT EXISTS idx_email_events_tenant ON public.email_events(tenant_id);

ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_sends_member_read" ON public.email_sends;
CREATE POLICY "email_sends_member_read" ON public.email_sends FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "email_sends_admin_write" ON public.email_sends;
CREATE POLICY "email_sends_admin_write" ON public.email_sends FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "email_campaigns_member_read" ON public.email_campaigns;
CREATE POLICY "email_campaigns_member_read" ON public.email_campaigns FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "email_campaigns_admin_write" ON public.email_campaigns;
CREATE POLICY "email_campaigns_admin_write" ON public.email_campaigns FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- email_events: лише super_admin читає; запис тільки через service role
DROP POLICY IF EXISTS "email_events_super_read" ON public.email_events;
CREATE POLICY "email_events_super_read" ON public.email_events FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (tenant_id IS NOT NULL AND public.is_tenant_admin(tenant_id)));