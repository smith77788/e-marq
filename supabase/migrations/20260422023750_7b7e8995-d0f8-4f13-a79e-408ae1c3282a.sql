
-- Sprint 11 — Site Builder foundation (fixed function signatures)

CREATE TABLE IF NOT EXISTS public.site_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  source_project_id TEXT,
  source_commit TEXT,
  default_locale TEXT NOT NULL DEFAULT 'ua',
  preview_url TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_templates select for authenticated"
ON public.site_templates FOR SELECT
TO authenticated
USING (is_active = true OR public.is_super_admin());

CREATE POLICY "site_templates super-admin write"
ON public.site_templates FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

CREATE TRIGGER trg_site_templates_updated
BEFORE UPDATE ON public.site_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) site_brand_profiles
CREATE TABLE IF NOT EXISTS public.site_brand_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.site_templates(id) ON DELETE RESTRICT,
  brand_name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  logo_url TEXT,
  favicon_url TEXT,
  og_image_url TEXT,
  primary_color TEXT NOT NULL DEFAULT 'oklch(0.55 0.18 260)',
  accent_color TEXT NOT NULL DEFAULT 'oklch(0.72 0.15 200)',
  font_family TEXT NOT NULL DEFAULT 'Inter',
  contact_email TEXT,
  contact_phone TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_domain TEXT,
  locale TEXT NOT NULL DEFAULT 'ua',
  currency TEXT NOT NULL DEFAULT 'UAH',
  legal_entity TEXT,
  address TEXT,
  hero_copy TEXT,
  about_copy TEXT,
  legal_pages JSONB NOT NULL DEFAULT '{}'::jsonb,
  food_categories_seed JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_site_brand_profiles_tenant ON public.site_brand_profiles (tenant_id);

ALTER TABLE public.site_brand_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_brand_profiles select"
ON public.site_brand_profiles FOR SELECT
TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_super_admin());

CREATE POLICY "site_brand_profiles insert"
ON public.site_brand_profiles FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id) OR public.is_super_admin());

CREATE POLICY "site_brand_profiles update"
ON public.site_brand_profiles FOR UPDATE
TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_super_admin())
WITH CHECK (public.is_tenant_member(tenant_id) OR public.is_super_admin());

CREATE POLICY "site_brand_profiles delete"
ON public.site_brand_profiles FOR DELETE
TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_super_admin());

CREATE TRIGGER trg_site_brand_profiles_updated
BEFORE UPDATE ON public.site_brand_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) site_builds
CREATE TABLE IF NOT EXISTS public.site_builds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.site_templates(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','building','ready','failed','cancelled')),
  archive_path TEXT,
  archive_size_bytes BIGINT,
  archive_sha256 TEXT,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_builds_tenant_created ON public.site_builds (tenant_id, created_at DESC);

ALTER TABLE public.site_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_builds select"
ON public.site_builds FOR SELECT
TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_super_admin());

CREATE POLICY "site_builds insert"
ON public.site_builds FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id) OR public.is_super_admin());

CREATE POLICY "site_builds super-admin update"
ON public.site_builds FOR UPDATE
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

CREATE TRIGGER trg_site_builds_updated
BEFORE UPDATE ON public.site_builds
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) seed initial template (idempotent)
INSERT INTO public.site_templates (template_key, name, description, source_project_id, default_locale, preview_url, capabilities, is_active)
VALUES (
  'mfd',
  'My Food Diary — White-label',
  'Шаблон: повноцінний D2C-сайт з каталогом, ШІ-щоденником харчування, кошиком, замовленнями, лояльністю. Адаптується під ваш бренд.',
  'a74eaa2d-62ac-4a30-98d6-1c37f45f6f79',
  'ua',
  'https://basicfood.lovable.app',
  '{"sections":["catalog","cart","ai-diary","loyalty","blog"],"locales":["ua","en"],"currencies":["UAH","USD","EUR"]}'::jsonb,
  true
)
ON CONFLICT (template_key) DO NOTHING;

-- 5) Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('site-builds', 'site-builds', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "site-builds tenant member read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'site-builds'
  AND (
    public.is_super_admin()
    OR public.is_tenant_member((split_part(name, '/', 1))::uuid)
  )
);

CREATE POLICY "site-builds super-admin all"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'site-builds' AND public.is_super_admin())
WITH CHECK (bucket_id = 'site-builds' AND public.is_super_admin());
