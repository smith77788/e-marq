-- 1. PRODUCTS: прибрати публічне читання
DROP POLICY IF EXISTS "products_public_read_active" ON public.products;
DROP POLICY IF EXISTS "Public can read active products" ON public.products;

-- 2. PRODUCT_BUNDLES: прибрати публічне читання
DROP POLICY IF EXISTS "bundles_public_read" ON public.product_bundles;
DROP POLICY IF EXISTS "Public can read active bundles" ON public.product_bundles;

-- 3. RPC для бандлів storefront
CREATE OR REPLACE FUNCTION public.get_storefront_bundles(_slug text)
RETURNS TABLE(
  id uuid,
  name text,
  description text,
  product_ids uuid[],
  bundle_price_cents integer,
  individual_price_cents integer,
  discount_pct numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tid uuid;
BEGIN
  SELECT t.id INTO _tid FROM public.tenants t
   WHERE t.slug = _slug AND t.status = 'active' LIMIT 1;
  IF _tid IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT b.id, b.name, b.description, b.product_ids,
           b.bundle_price_cents, b.individual_price_cents, b.discount_pct
    FROM public.product_bundles b
    WHERE b.tenant_id = _tid AND b.is_active = true
    ORDER BY b.created_at DESC
    LIMIT 100;
END; $$;

REVOKE ALL ON FUNCTION public.get_storefront_bundles(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_storefront_bundles(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_products(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_config(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_page(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_social_proof(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_promo_code(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_storefront_order(uuid, text, text, jsonb, text) TO anon, authenticated;

-- 4. EVENTS: anon insert лише з валідним session_id
DROP POLICY IF EXISTS "events_insert_active_tenant" ON public.events;
CREATE POLICY "events_insert_anon_with_session"
ON public.events
FOR INSERT
TO anon
WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = events.tenant_id AND t.status = 'active')
  AND events.session_id IS NOT NULL
  AND length(events.session_id) BETWEEN 10 AND 128
  AND events.user_id IS NULL
);
CREATE POLICY "events_insert_authenticated"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = events.tenant_id AND t.status = 'active')
);

-- 5. SEARCH_QUERIES: anon заборонено, тільки authenticated
DROP POLICY IF EXISTS "search_queries_insert_active_tenant" ON public.search_queries;
CREATE POLICY "search_queries_insert_authenticated_only"
ON public.search_queries
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = search_queries.tenant_id AND t.status = 'active')
);