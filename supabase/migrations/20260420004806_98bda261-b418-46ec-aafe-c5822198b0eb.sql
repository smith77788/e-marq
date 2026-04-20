CREATE OR REPLACE FUNCTION public.get_public_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _order public.orders;
  _items jsonb;
  _config jsonb;
  _tenant jsonb;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'product_name', oi.product_name,
      'quantity', oi.quantity,
      'unit_price_cents', oi.unit_price_cents
    ) ORDER BY oi.created_at
  ) INTO _items
  FROM public.order_items oi
  WHERE oi.order_id = _order_id;

  SELECT jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'name', t.name
  ) INTO _tenant
  FROM public.tenants t
  WHERE t.id = _order.tenant_id;

  SELECT jsonb_build_object(
    'brand_name', tc.brand_name,
    'features', tc.features
  ) INTO _config
  FROM public.tenant_configs tc
  WHERE tc.tenant_id = _order.tenant_id;

  RETURN jsonb_build_object(
    'order', jsonb_build_object(
      'id', _order.id,
      'status', _order.status,
      'payment_method', _order.payment_method,
      'payment_ref', _order.payment_ref,
      'total_cents', _order.total_cents,
      'currency', _order.currency,
      'customer_email', _order.customer_email,
      'customer_name', _order.customer_name,
      'created_at', _order.created_at,
      'paid_at', _order.paid_at,
      'tenant_id', _order.tenant_id
    ),
    'items', COALESCE(_items, '[]'::jsonb),
    'tenant', _tenant,
    'config', _config
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_order(uuid) TO anon, authenticated;