CREATE OR REPLACE FUNCTION public.validate_discount_code(
  _slug TEXT, _code TEXT, _order_total_cents INTEGER, _customer_email TEXT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id UUID;
  v_promo RECORD;
  v_discount_cents INTEGER;
BEGIN
  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  WHERE t.slug = _slug AND t.status = 'active';
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'store_not_found');
  END IF;

  SELECT * INTO v_promo FROM public.promotions
  WHERE tenant_id = v_tenant_id
    AND UPPER(code) = UPPER(_code)
    AND is_active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
    AND (usage_limit IS NULL OR times_used < usage_limit)
  LIMIT 1;

  IF v_promo IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_or_expired');
  END IF;

  IF v_promo.min_order_cents > 0 AND _order_total_cents < v_promo.min_order_cents THEN
    RETURN jsonb_build_object(
      'valid', false, 'error', 'below_minimum',
      'min_cents', v_promo.min_order_cents
    );
  END IF;

  IF v_promo.promo_type = 'percent_off' THEN
    v_discount_cents := (_order_total_cents * v_promo.value::numeric / 100)::INTEGER;
  ELSIF v_promo.promo_type = 'fixed_off' THEN
    v_discount_cents := LEAST((v_promo.value::INTEGER) * 100, _order_total_cents);
  ELSE
    v_discount_cents := 0;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'promo_id', v_promo.id,
    'code', v_promo.code,
    'name', v_promo.name,
    'type', v_promo.promo_type,
    'discount_cents', v_discount_cents
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.validate_discount_code(TEXT, TEXT, INTEGER, TEXT) TO anon, authenticated;