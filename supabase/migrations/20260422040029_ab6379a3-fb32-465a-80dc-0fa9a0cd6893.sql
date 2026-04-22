-- ============================================================
-- 1) Lead-discovery infrastructure
-- ============================================================

-- prospects: знайдені бренди/магазини, які можуть стати клієнтами
CREATE TABLE IF NOT EXISTS public.lead_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,                     -- 'web_prospector' | 'social_engager' | 'content_magnet' | 'manual'
  source_query text,                        -- ключове слово/нішa, з якої знайдено
  name text NOT NULL,
  website_url text,
  instagram_handle text,
  email text,
  telegram_handle text,
  niche text,                               -- 'cosmetics', 'food', 'fashion', ...
  country text DEFAULT 'UA',
  estimated_size text,                      -- 'micro' | 'small' | 'mid' | 'large'
  fit_score int NOT NULL DEFAULT 50,        -- 0..100
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,  -- знайдені тригери (ціни, UI хвости, відсутність бота...)
  status text NOT NULL DEFAULT 'discovered',-- discovered | qualified | engaging | converted | rejected | unreachable
  rejected_reason text,
  converted_tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  last_contacted_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- унікальність: один website_url або instagram у нашій базі
CREATE UNIQUE INDEX IF NOT EXISTS lead_prospects_website_uq
  ON public.lead_prospects (lower(website_url)) WHERE website_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lead_prospects_instagram_uq
  ON public.lead_prospects (lower(instagram_handle)) WHERE instagram_handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_prospects_status_idx
  ON public.lead_prospects (status, fit_score DESC, created_at DESC);

ALTER TABLE public.lead_prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_prospects_super_select"
  ON public.lead_prospects FOR SELECT TO authenticated
  USING (public.is_super_admin());
CREATE POLICY "lead_prospects_super_insert"
  ON public.lead_prospects FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());
CREATE POLICY "lead_prospects_super_update"
  ON public.lead_prospects FOR UPDATE TO authenticated
  USING (public.is_super_admin());
CREATE POLICY "lead_prospects_super_delete"
  ON public.lead_prospects FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- лог дій outreach для конкретного prospect
CREATE TABLE IF NOT EXISTS public.lead_outreach (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.lead_prospects(id) ON DELETE CASCADE,
  channel text NOT NULL,                    -- 'email' | 'instagram_dm' | 'instagram_comment' | 'telegram' | 'web_form' | 'organic_content'
  intent text NOT NULL,                     -- 'first_touch' | 'follow_up' | 'demo_invite' | 'content_drop'
  status text NOT NULL DEFAULT 'queued',    -- queued | sent | delivered | replied | bounced | skipped
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, -- {subject, body, link, etc}
  response text,
  sent_at timestamptz,
  reply_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_outreach_prospect_idx
  ON public.lead_outreach (prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_outreach_status_idx
  ON public.lead_outreach (status, created_at DESC);

ALTER TABLE public.lead_outreach ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_outreach_super_all"
  ON public.lead_outreach FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- magnets: автогенеровані SEO-сторінки/гайди, які залучають трафік
CREATE TABLE IF NOT EXISTS public.lead_magnets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  meta_description text,
  body_md text NOT NULL,
  topic text,
  keywords text[] NOT NULL DEFAULT '{}',
  cta_url text NOT NULL DEFAULT '/signup',
  views_count int NOT NULL DEFAULT 0,
  signups_attributed int NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_magnets_published_idx
  ON public.lead_magnets (is_published, created_at DESC);

ALTER TABLE public.lead_magnets ENABLE ROW LEVEL SECURITY;
-- magnets читаються публічно (це посадкові сторінки), пишуть лише супер-адміни
CREATE POLICY "lead_magnets_public_read"
  ON public.lead_magnets FOR SELECT TO anon, authenticated
  USING (is_published = true);
CREATE POLICY "lead_magnets_super_write"
  ON public.lead_magnets FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- shared touch trigger
CREATE OR REPLACE FUNCTION public.touch_lead_tables()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS lead_prospects_touch ON public.lead_prospects;
CREATE TRIGGER lead_prospects_touch
  BEFORE UPDATE ON public.lead_prospects
  FOR EACH ROW EXECUTE FUNCTION public.touch_lead_tables();

DROP TRIGGER IF EXISTS lead_magnets_touch ON public.lead_magnets;
CREATE TRIGGER lead_magnets_touch
  BEFORE UPDATE ON public.lead_magnets
  FOR EACH ROW EXECUTE FUNCTION public.touch_lead_tables();

-- ============================================================
-- 2) Custom domains for storefronts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',   -- pending | verifying | active | failed
  verification_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  verified_at timestamptz,
  last_checked_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_domain_uq
  ON public.tenant_domains (lower(domain));
CREATE INDEX IF NOT EXISTS tenant_domains_tenant_idx
  ON public.tenant_domains (tenant_id, is_primary DESC);

ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_domains_select_member_or_super"
  ON public.tenant_domains FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "tenant_domains_insert_member_or_super"
  ON public.tenant_domains FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "tenant_domains_update_member_or_super"
  ON public.tenant_domains FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));
CREATE POLICY "tenant_domains_delete_member_or_super"
  ON public.tenant_domains FOR DELETE TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

DROP TRIGGER IF EXISTS tenant_domains_touch ON public.tenant_domains;
CREATE TRIGGER tenant_domains_touch
  BEFORE UPDATE ON public.tenant_domains
  FOR EACH ROW EXECUTE FUNCTION public.touch_lead_tables();

-- ============================================================
-- 3) RPC: super-admin marks topup as paid → grants AI credits atomically
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_mark_topup_paid(
  _request_id uuid,
  _manager_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _req public.topup_requests%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin only';
  END IF;
  SELECT * INTO _req FROM public.topup_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF _req.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true);
  END IF;

  -- credit AI balance via existing RPC
  PERFORM public.owner_topup_ai_credits(
    _req.tenant_id,
    _req.credits,
    coalesce('Manager-confirmed top-up #' || substr(_req.id::text, 1, 8),
             'Manager-confirmed top-up')
  );

  UPDATE public.topup_requests
     SET status = 'paid',
         manager_note = coalesce(_manager_note, manager_note),
         processed_at = now()
   WHERE id = _request_id;

  RETURN jsonb_build_object('ok', true, 'credits', _req.credits);
END $$;

-- ensure topup_requests has processed_at column referenced above
ALTER TABLE public.topup_requests
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.topup_requests
  ADD COLUMN IF NOT EXISTS processed_by uuid;