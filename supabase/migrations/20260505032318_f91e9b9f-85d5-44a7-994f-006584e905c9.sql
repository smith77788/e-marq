CREATE OR REPLACE FUNCTION public.storefront_bundle_recommendations(
  _tenant_id uuid,
  _product_id uuid,
  _limit int DEFAULT 4
) RETURNS TABLE(
  product_id uuid,
  name text,
  price_cents bigint,
  image_url text,
  lift numeric,
  co_orders int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH pairs AS (
    SELECT
      CASE WHEN bs.product_a_id = _product_id THEN bs.product_b_id ELSE bs.product_a_id END AS other_id,
      bs.lift,
      bs.co_orders
    FROM public.bundle_suggestions bs
    WHERE bs.tenant_id = _tenant_id
      AND (bs.product_a_id = _product_id OR bs.product_b_id = _product_id)
      AND bs.lift >= 1.05
      AND bs.co_orders >= 3
  )
  SELECT
    p.id, p.name, p.price_cents::bigint, p.image_url,
    pairs.lift, pairs.co_orders
  FROM pairs
  JOIN public.products p ON p.id = pairs.other_id
  WHERE p.tenant_id = _tenant_id
    AND p.is_active = true
    AND p.stock > 0
  ORDER BY pairs.lift DESC, pairs.co_orders DESC
  LIMIT GREATEST(1, LEAST(_limit, 12));
$$;

GRANT EXECUTE ON FUNCTION public.storefront_bundle_recommendations(uuid, uuid, int) TO anon, authenticated;