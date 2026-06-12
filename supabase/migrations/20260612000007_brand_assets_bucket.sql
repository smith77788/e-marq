-- Brand assets bucket: logo / hero / banner images uploaded by tenant owners
-- from brand.settings. Path scheme: `<tenant_id>/<field>-<timestamp>.<ext>`.
-- Public read (the storefront serves these via public URLs); insert/update/
-- delete only for authenticated members of the tenant that owns the prefix.

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Direct-object public read, tenant-prefixed paths only (same approach as
-- product-images: known URLs are fetchable, bucket root is not listable).
DROP POLICY IF EXISTS "brand_assets_public_read" ON storage.objects;
CREATE POLICY "brand_assets_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'brand-assets'
    AND (storage.foldername(name))[1] IS NOT NULL
  );

-- Writes are allowed only inside the caller's own `<tenant_id>/...` prefix.
-- public.is_tenant_member() (SECURITY DEFINER) checks tenant_memberships and
-- allows super admins. CASE guards the uuid cast: a non-uuid first segment
-- yields false instead of a cast error.
DROP POLICY IF EXISTS "brand_assets_member_insert" ON storage.objects;
CREATE POLICY "brand_assets_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_tenant_member(((storage.foldername(name))[1])::uuid)
      ELSE false
    END
  );

DROP POLICY IF EXISTS "brand_assets_member_update" ON storage.objects;
CREATE POLICY "brand_assets_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_tenant_member(((storage.foldername(name))[1])::uuid)
      ELSE false
    END
  )
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_tenant_member(((storage.foldername(name))[1])::uuid)
      ELSE false
    END
  );

DROP POLICY IF EXISTS "brand_assets_member_delete" ON storage.objects;
CREATE POLICY "brand_assets_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_tenant_member(((storage.foldername(name))[1])::uuid)
      ELSE false
    END
  );
