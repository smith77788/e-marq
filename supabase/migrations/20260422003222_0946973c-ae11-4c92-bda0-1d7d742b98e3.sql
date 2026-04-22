-- ============================================================
-- AUDIT V2 FIX #1 — Storage product-images: tenant-scoped writes
-- ============================================================

-- Drop overly permissive write policies
DROP POLICY IF EXISTS "product_images_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "product_images_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "product_images_auth_delete" ON storage.objects;

-- Re-create write policies with tenant ownership check.
-- Path layout: `{tenant_id}/{product_id}/{uuid}.ext`
-- The first folder name MUST equal a tenant_id where the user is a member.
CREATE POLICY "product_images_member_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.is_super_admin()
      OR public.is_tenant_member(((storage.foldername(name))[1])::uuid)
    )
  );

CREATE POLICY "product_images_member_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (
      public.is_super_admin()
      OR public.is_tenant_member(((storage.foldername(name))[1])::uuid)
    )
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND (
      public.is_super_admin()
      OR public.is_tenant_member(((storage.foldername(name))[1])::uuid)
    )
  );

CREATE POLICY "product_images_member_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (
      public.is_super_admin()
      OR public.is_tenant_member(((storage.foldername(name))[1])::uuid)
    )
  );

-- ============================================================
-- AUDIT V2 FIX #2 — Tighten public read for product-images
-- (only show files of active tenants)
-- ============================================================
DROP POLICY IF EXISTS "product_images_public_read" ON storage.objects;
CREATE POLICY "product_images_public_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND t.status = 'active'
    )
  );

-- ============================================================
-- AUDIT V2 FIX #3 — Restock notifications: kill anon-INSERT,
-- force everything through SECURITY DEFINER RPC + rate limit
-- ============================================================

-- Remove direct anon INSERT policy. From now on subscribers can only
-- be created via subscribe_restock_notification() (SECURITY DEFINER).
DROP POLICY IF EXISTS "restock_anon_insert" ON public.restock_notifications;

-- Per-IP rate-limit table for the public RPC.
CREATE TABLE IF NOT EXISTS public.restock_subscribe_rate_limit (
  id BIGSERIAL PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  bucket_hour TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (ip_hash, bucket_hour)
);
CREATE INDEX IF NOT EXISTS idx_rsrl_bucket
  ON public.restock_subscribe_rate_limit (bucket_hour);

ALTER TABLE public.restock_subscribe_rate_limit ENABLE ROW LEVEL SECURITY;
-- Internal counters; only super_admin can read directly. Function uses SECURITY DEFINER.
CREATE POLICY "rsrl_admin_read" ON public.restock_subscribe_rate_limit
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Replace RPC with rate-limited version (signature unchanged: 4 UUID/TEXT params)
CREATE OR REPLACE FUNCTION public.subscribe_restock_notification(
  _tenant_id UUID,
  _product_id UUID,
  _variant_id UUID,
  _email TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email TEXT;
  v_ip_hash TEXT;
  v_bucket TIMESTAMPTZ;
  v_count INTEGER;
  v_id UUID;
  v_already BOOLEAN;
  v_product RECORD;
  v_variant RECORD;
BEGIN
  -- 1) Email validation
  v_clean_email := lower(btrim(coalesce(_email, '')));
  IF v_clean_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  -- 2) Rate-limit (max 5 / hour per requester IP). The IP is exposed by
  --    PostgREST through the request headers GUC. We hash it with sha256.
  v_ip_hash := encode(
    digest(
      coalesce(
        nullif(current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip', ''),
        nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''),
        nullif(current_setting('request.headers', true)::jsonb ->> 'x-real-ip', ''),
        'anon'
      ),
      'sha256'
    ),
    'hex'
  );
  v_bucket := date_trunc('hour', now());

  INSERT INTO public.restock_subscribe_rate_limit (ip_hash, bucket_hour, count)
  VALUES (v_ip_hash, v_bucket, 1)
  ON CONFLICT (ip_hash, bucket_hour)
  DO UPDATE SET count = public.restock_subscribe_rate_limit.count + 1
  RETURNING count INTO v_count;

  IF v_count > 5 THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- 3) Tenant + product check
  SELECT p.id, p.stock, p.is_active
    INTO v_product
    FROM public.products p
    JOIN public.tenants t ON t.id = p.tenant_id
   WHERE p.id = _product_id
     AND p.tenant_id = _tenant_id
     AND p.is_active = true
     AND t.status = 'active';

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  -- 4) Variant (optional) check
  IF _variant_id IS NOT NULL THEN
    SELECT v.id, v.stock, v.is_active
      INTO v_variant
      FROM public.product_variants v
     WHERE v.id = _variant_id
       AND v.product_id = _product_id
       AND v.tenant_id = _tenant_id
       AND v.is_active = true;

    IF v_variant.id IS NULL THEN
      RAISE EXCEPTION 'variant_not_found';
    END IF;
    IF v_variant.stock > 0 THEN
      RAISE EXCEPTION 'variant_in_stock';
    END IF;
  ELSE
    IF v_product.stock > 0 THEN
      RAISE EXCEPTION 'product_in_stock';
    END IF;
  END IF;

  -- 5) Idempotent upsert
  INSERT INTO public.restock_notifications
    (tenant_id, product_id, variant_id, customer_email, status)
  VALUES (_tenant_id, _product_id, _variant_id, v_clean_email, 'pending')
  ON CONFLICT (tenant_id, product_id, variant_id, customer_email)
  DO UPDATE SET status = 'pending', notified_at = NULL
  RETURNING id INTO v_id;

  SELECT (created_at < (now() - interval '5 seconds'))
    INTO v_already
    FROM public.restock_notifications
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'already_subscribed', COALESCE(v_already, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_restock_notification(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscribe_restock_notification(UUID, UUID, UUID, TEXT)
  TO anon, authenticated;

-- Periodic cleanup of stale rate-limit rows (>2h ago) — best-effort during writes.
CREATE OR REPLACE FUNCTION public.cleanup_restock_rate_limit() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.restock_subscribe_rate_limit
   WHERE bucket_hour < (now() - interval '2 hours');
$$;