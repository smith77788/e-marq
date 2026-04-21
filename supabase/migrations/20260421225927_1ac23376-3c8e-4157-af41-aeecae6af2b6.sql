-- =====================================================
-- Email infrastructure expansion: webhooks, suppression, campaigns
-- =====================================================

-- 1) Add delivered_at to email_sends
ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS complained_at timestamptz;

-- 2) Suppression list — emails that bounced / complained / unsubscribed
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('bounce', 'complaint', 'unsubscribe', 'manual')),
  source_event_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One suppression per (tenant, email, reason). NULL tenant = global suppression.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppressions_scoped
  ON public.email_suppressions (COALESCE(tenant_id::text, 'global'), lower(email), reason);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_email
  ON public.email_suppressions (lower(email));

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_suppressions_admin_read ON public.email_suppressions;
CREATE POLICY email_suppressions_admin_read
  ON public.email_suppressions
  FOR SELECT
  TO authenticated
  USING (is_super_admin() OR (tenant_id IS NOT NULL AND is_tenant_admin(tenant_id)));

DROP POLICY IF EXISTS email_suppressions_admin_write ON public.email_suppressions;
CREATE POLICY email_suppressions_admin_write
  ON public.email_suppressions
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin() OR (tenant_id IS NOT NULL AND is_tenant_admin(tenant_id)));

DROP POLICY IF EXISTS email_suppressions_admin_delete ON public.email_suppressions;
CREATE POLICY email_suppressions_admin_delete
  ON public.email_suppressions
  FOR DELETE
  TO authenticated
  USING (is_super_admin() OR (tenant_id IS NOT NULL AND is_tenant_admin(tenant_id)));

-- 3) Campaign recipients — track every send within a campaign
CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped_suppressed')),
  resend_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign
  ON public.email_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_tenant
  ON public.email_campaign_recipients (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_recipient_per_email
  ON public.email_campaign_recipients (campaign_id, lower(to_email));

ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_recipients_member_read ON public.email_campaign_recipients;
CREATE POLICY campaign_recipients_member_read
  ON public.email_campaign_recipients
  FOR SELECT
  TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));

DROP POLICY IF EXISTS campaign_recipients_admin_write ON public.email_campaign_recipients;
CREATE POLICY campaign_recipients_admin_write
  ON public.email_campaign_recipients
  FOR ALL
  TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));

-- 4) Add unsubscribe_token to customers for one-click unsubscribe links
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_unsub_token
  ON public.customers (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;

-- Backfill any existing rows that might be NULL
UPDATE public.customers SET unsubscribe_token = gen_random_uuid()
  WHERE unsubscribe_token IS NULL;

ALTER TABLE public.customers
  ALTER COLUMN unsubscribe_token SET NOT NULL;

-- 5) Helper function: check if an email is suppressed for a tenant
CREATE OR REPLACE FUNCTION public.is_email_suppressed(_tenant_id uuid, _email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.email_suppressions
    WHERE lower(email) = lower(_email)
      AND (tenant_id = _tenant_id OR tenant_id IS NULL)
  );
$$;