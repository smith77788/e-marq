CREATE OR REPLACE FUNCTION public.get_storefront_product_detail(_slug text, _product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_product jsonb;
  v_variants jsonb;
  v_images jsonb;
BEGIN
  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  WHERE t.slug = _slug AND t.status = 'active';

  IF v_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(p) - 'metadata' INTO v_product
  FROM (
    SELECT
      p.id, p.name, p.description, p.price_cents, p.compare_at_price_cents,
      p.currency, p.image_url, p.stock, p.has_variants, p.tags, p.url_handle,
      p.seo_title, p.seo_description
    FROM public.products p
    WHERE p.id = _product_id
      AND p.tenant_id = v_tenant_id
      AND p.is_active = true
    LIMIT 1
  ) p;

  IF v_product IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(variant_json ORDER BY created_at),
    '[]'::jsonb
  )
  INTO v_variants
  FROM (
    SELECT
      to_jsonb(v) - 'created_at' AS variant_json,
      v.created_at
    FROM (
      SELECT
        pv.id, pv.sku,
        pv.option_1_name, pv.option_1_value,
        pv.option_2_name, pv.option_2_value,
        pv.option_3_name, pv.option_3_value,
        pv.price_cents, pv.compare_at_price_cents,
        pv.stock, pv.image_url,
        pv.created_at
      FROM public.product_variants pv
      WHERE pv.product_id = _product_id
        AND pv.tenant_id = v_tenant_id
        AND pv.is_active = true
    ) v
  ) ordered_variants;

  SELECT COALESCE(
    jsonb_agg(image_json ORDER BY position, created_at),
    '[]'::jsonb
  )
  INTO v_images
  FROM (
    SELECT
      to_jsonb(i) - 'created_at' AS image_json,
      i.position,
      i.created_at
    FROM (
      SELECT
        pi.id, pi.url, pi.alt, pi.position, pi.is_primary,
        pi.created_at
      FROM public.product_images pi
      WHERE pi.product_id = _product_id
        AND pi.tenant_id = v_tenant_id
    ) i
  ) ordered_images;

  RETURN jsonb_build_object(
    'product', v_product,
    'variants', v_variants,
    'images', v_images
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_storefront_product_detail(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_storefront_collection_products(_slug text, _handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_collection jsonb;
  v_products jsonb;
BEGIN
  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  WHERE t.slug = _slug AND t.status = 'active';

  IF v_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(c) INTO v_collection
  FROM (
    SELECT id, handle, name, description, image_url, seo_title, seo_description
    FROM public.collections
    WHERE tenant_id = v_tenant_id AND handle = _handle AND is_active = true
    LIMIT 1
  ) c;

  IF v_collection IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(product_json ORDER BY position),
    '[]'::jsonb
  )
  INTO v_products
  FROM (
    SELECT
      to_jsonb(p) AS product_json,
      p.position
    FROM (
      SELECT
        p.id, p.name, p.description, p.price_cents, p.compare_at_price_cents,
        p.currency, p.image_url, p.stock, p.has_variants, p.tags, p.url_handle,
        cp.position
      FROM public.collection_products cp
      JOIN public.products p ON p.id = cp.product_id
      WHERE cp.collection_id = (v_collection->>'id')::uuid
        AND p.is_active = true
    ) p
  ) ordered_products;

  RETURN jsonb_build_object('collection', v_collection, 'products', v_products);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_storefront_collection_products(text, text) TO anon, authenticated;