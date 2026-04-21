-- Helper для безпечного додавання колонок
CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT,
  option_1_name TEXT,
  option_1_value TEXT,
  option_2_name TEXT,
  option_2_value TEXT,
  option_3_name TEXT,
  option_3_value TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  compare_at_price_cents INTEGER,
  stock INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_tenant ON public.product_variants(tenant_id);
DROP TRIGGER IF EXISTS trg_variants_updated_at ON public.product_variants;
CREATE TRIGGER trg_variants_updated_at BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_images_product ON public.product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_images_tenant ON public.product_images(tenant_id);

CREATE TABLE IF NOT EXISTS public.collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  is_smart BOOLEAN NOT NULL DEFAULT false,
  rules JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, handle)
);
CREATE INDEX IF NOT EXISTS idx_collections_tenant ON public.collections(tenant_id);
DROP TRIGGER IF EXISTS trg_collections_updated_at ON public.collections;
CREATE TRIGGER trg_collections_updated_at BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.collection_products (
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_products_tenant ON public.collection_products(tenant_id);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS compare_at_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS url_handle TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER,
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS has_variants BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_address JSONB,
  ADD COLUMN IF NOT EXISTS shipping_method TEXT,
  ADD COLUMN IF NOT EXISTS shipping_cost_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "variants_member_read" ON public.product_variants;
CREATE POLICY "variants_member_read" ON public.product_variants FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "variants_admin_write" ON public.product_variants;
CREATE POLICY "variants_admin_write" ON public.product_variants FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "variants_anon_read" ON public.product_variants;
CREATE POLICY "variants_anon_read" ON public.product_variants FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "images_member_read" ON public.product_images;
CREATE POLICY "images_member_read" ON public.product_images FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "images_admin_write" ON public.product_images;
CREATE POLICY "images_admin_write" ON public.product_images FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "images_anon_read" ON public.product_images;
CREATE POLICY "images_anon_read" ON public.product_images FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "collections_member_read" ON public.collections;
CREATE POLICY "collections_member_read" ON public.collections FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "collections_admin_write" ON public.collections;
CREATE POLICY "collections_admin_write" ON public.collections FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "collections_anon_read" ON public.collections;
CREATE POLICY "collections_anon_read" ON public.collections FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "collection_products_member_read" ON public.collection_products;
CREATE POLICY "collection_products_member_read" ON public.collection_products FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "collection_products_admin_write" ON public.collection_products;
CREATE POLICY "collection_products_admin_write" ON public.collection_products FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "collection_products_anon_read" ON public.collection_products;
CREATE POLICY "collection_products_anon_read" ON public.collection_products FOR SELECT TO anon
  USING (true);

CREATE OR REPLACE FUNCTION public.get_storefront_products_v2(_slug TEXT)
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, price_cents INTEGER,
  compare_at_price_cents INTEGER, currency TEXT, image_url TEXT,
  stock INTEGER, has_variants BOOLEAN, tags TEXT[], url_handle TEXT
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.description, p.price_cents, p.compare_at_price_cents,
         p.currency, p.image_url, p.stock, p.has_variants, p.tags, p.url_handle
  FROM public.products p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE t.slug = _slug AND t.status = 'active' AND p.is_active = true
  ORDER BY p.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_storefront_products_v2(TEXT) TO anon, authenticated;