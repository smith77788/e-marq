-- 1) PROMOTIONS — закрити публічний read
DROP POLICY IF EXISTS "promotions_public_read" ON public.promotions;
DROP POLICY IF EXISTS "promotions_select_active" ON public.promotions;
DROP POLICY IF EXISTS "promotions_anon_read" ON public.promotions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='promotions' AND policyname='promotions_member_read'
  ) THEN
    CREATE POLICY "promotions_member_read"
      ON public.promotions FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_promo_code(_tenant_id uuid, _code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.promotions;
BEGIN
  IF _code IS NULL OR length(trim(_code)) = 0 OR length(_code) > 64 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_code');
  END IF;
  SELECT * INTO _row FROM public.promotions
   WHERE tenant_id = _tenant_id
     AND lower(code) = lower(trim(_code))
     AND is_active = true
     AND (starts_at IS NULL OR starts_at <= now())
     AND (ends_at   IS NULL OR ends_at   >  now())
   LIMIT 1;
  IF _row.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found_or_expired');
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'discount_type', _row.discount_type,
    'discount_value', _row.discount_value,
    'min_order_cents', COALESCE(_row.min_order_cents, 0)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.validate_promo_code(uuid, text) TO anon, authenticated;

-- 2) PRODUCTS — safe RPC без точної кількості залишків
CREATE OR REPLACE FUNCTION public.get_storefront_products(_slug text)
RETURNS TABLE (
  id uuid, name text, description text, price_cents integer, currency text,
  image_url text, stock_available boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid uuid;
BEGIN
  SELECT t.id INTO _tid FROM public.tenants t WHERE t.slug = _slug AND t.status = 'active' LIMIT 1;
  IF _tid IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.id, p.name, p.description, p.price_cents, p.currency, p.image_url,
           (p.stock IS NULL OR p.stock > 0) AS stock_available
    FROM public.products p
    WHERE p.tenant_id = _tid AND p.is_active = true
    ORDER BY p.created_at DESC LIMIT 500;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_storefront_products(text) TO anon, authenticated;

-- 3) SOCIAL PROOF — закрити публічний read
DROP POLICY IF EXISTS "social_proof_public_read" ON public.social_proof_events;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='social_proof_events' AND policyname='social_proof_member_read'
  ) THEN
    CREATE POLICY "social_proof_member_read"
      ON public.social_proof_events FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_storefront_social_proof(_slug text, _limit int DEFAULT 10)
RETURNS SETOF public.social_proof_events
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid uuid;
BEGIN
  SELECT id INTO _tid FROM public.tenants WHERE slug = _slug AND status = 'active' LIMIT 1;
  IF _tid IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT * FROM public.social_proof_events
    WHERE tenant_id = _tid AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 50));
END; $$;
GRANT EXECUTE ON FUNCTION public.get_storefront_social_proof(text, int) TO anon, authenticated;

-- 4) CONTENT PAGES — slug-scoped RPC
DROP POLICY IF EXISTS "content_pages_public_read" ON public.content_pages;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_pages' AND policyname='content_pages_member_read'
  ) THEN
    CREATE POLICY "content_pages_member_read"
      ON public.content_pages FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_storefront_page(_slug text, _page_slug text)
RETURNS SETOF public.content_pages
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid uuid;
BEGIN
  SELECT id INTO _tid FROM public.tenants WHERE slug = _slug AND status = 'active' LIMIT 1;
  IF _tid IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT * FROM public.content_pages
    WHERE tenant_id = _tid AND slug = _page_slug AND is_published = true
    LIMIT 1;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_storefront_page(text, text) TO anon, authenticated;

-- 5) REALTIME — прибрати outbound_messages з publication
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'outbound_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.outbound_messages';
  END IF;
END $$;

-- 6) TENANT_INVITATIONS — приховати token
DROP POLICY IF EXISTS "ti_select" ON public.tenant_invitations;
DROP POLICY IF EXISTS "ti_select_invited" ON public.tenant_invitations;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenant_invitations' AND policyname='ti_select_admin_only'
  ) THEN
    CREATE POLICY "ti_select_admin_only"
      ON public.tenant_invitations FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.tenant_invitations;
BEGIN
  IF _token IS NULL OR length(_token) < 10 OR length(_token) > 200 THEN RETURN NULL; END IF;
  SELECT * INTO _row FROM public.tenant_invitations
   WHERE token = _token
     AND (expires_at IS NULL OR expires_at > now())
     AND accepted_at IS NULL
   LIMIT 1;
  IF _row.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', _row.id, 'tenant_id', _row.tenant_id, 'email', _row.email,
    'role', _row.role, 'expires_at', _row.expires_at
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO authenticated;

-- 7) EVENTS / SEARCH_QUERIES — rate-limit для anon
CREATE TABLE IF NOT EXISTS public.anon_event_rate_limit (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  session_id text NOT NULL,
  bucket_minute timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, session_id, bucket_minute)
);
CREATE INDEX IF NOT EXISTS idx_anon_rl_bucket ON public.anon_event_rate_limit(bucket_minute);
ALTER TABLE public.anon_event_rate_limit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_event_rate_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bucket timestamptz := date_trunc('minute', now());
  _sid text := COALESCE(NEW.session_id, 'anon');
  _new_count int;
BEGIN
  IF auth.uid() IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.anon_event_rate_limit(tenant_id, session_id, bucket_minute, count)
  VALUES (NEW.tenant_id, _sid, _bucket, 1)
  ON CONFLICT (tenant_id, session_id, bucket_minute)
  DO UPDATE SET count = public.anon_event_rate_limit.count + 1
  RETURNING count INTO _new_count;
  IF _new_count > 60 THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_events_rate_limit ON public.events;
CREATE TRIGGER trg_events_rate_limit
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_rate_limit();

DROP TRIGGER IF EXISTS trg_search_queries_rate_limit ON public.search_queries;
CREATE TRIGGER trg_search_queries_rate_limit
  BEFORE INSERT ON public.search_queries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_rate_limit();

CREATE OR REPLACE FUNCTION public.cleanup_anon_rate_limit()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.anon_event_rate_limit WHERE bucket_minute < now() - interval '24 hours';
$$;