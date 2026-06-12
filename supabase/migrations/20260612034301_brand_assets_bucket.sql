-- Brand assets bucket: logo / hero / OG images uploaded from the brand
-- settings page (src/routes/_authenticated/brand.settings.tsx).
--
-- Path scheme: `<tenant_id>/<field>-<uuid>.<ext>` — the first path segment
-- must be the tenant UUID, so write access can be scoped per tenant via the
-- existing public.is_tenant_member() helper (defined in 20260419225800).
--
-- Access model:
--   SELECT                — public (storefronts embed these URLs directly);
--   INSERT/UPDATE/DELETE  — authenticated tenant members (or super admins),
--                           only under their own `<tenant_id>/` prefix.
--
-- Idempotent: bucket insert uses ON CONFLICT DO NOTHING, policies are
-- guarded by pg_policies checks (same pattern as the avatars bucket in
-- 20260422033145).

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'brand_assets_public_read'
  ) THEN
    CREATE POLICY "brand_assets_public_read" ON storage.objects FOR SELECT
      USING (bucket_id = 'brand-assets');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'brand_assets_member_insert'
  ) THEN
    CREATE POLICY "brand_assets_member_insert" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'brand-assets'
        AND (
          public.is_super_admin()
          -- CASE guarantees the UUID-shape guard runs before the cast,
          -- so a non-UUID prefix is a clean denial, not a cast error.
          OR CASE
               WHEN (storage.foldername(name))[1]
                 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN public.is_tenant_member(((storage.foldername(name))[1])::uuid)
               ELSE false
             END
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'brand_assets_member_update'
  ) THEN
    CREATE POLICY "brand_assets_member_update" ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'brand-assets'
        AND (
          public.is_super_admin()
          OR CASE
               WHEN (storage.foldername(name))[1]
                 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN public.is_tenant_member(((storage.foldername(name))[1])::uuid)
               ELSE false
             END
        )
      )
      WITH CHECK (
        bucket_id = 'brand-assets'
        AND (
          public.is_super_admin()
          OR CASE
               WHEN (storage.foldername(name))[1]
                 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN public.is_tenant_member(((storage.foldername(name))[1])::uuid)
               ELSE false
             END
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'brand_assets_member_delete'
  ) THEN
    CREATE POLICY "brand_assets_member_delete" ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'brand-assets'
        AND (
          public.is_super_admin()
          OR CASE
               WHEN (storage.foldername(name))[1]
                 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN public.is_tenant_member(((storage.foldername(name))[1])::uuid)
               ELSE false
             END
        )
      );
  END IF;
END$$;
