-- Public RPC для підписки на restock-нотифікації зі сторфронту.
-- Робить idempotent upsert: повторне підписання повертає ту саму запис без помилки.
-- Має SECURITY DEFINER щоб обходити RLS, але всередині валідуємо що:
--   - email коректний;
--   - товар активний і належить тенанту;
--   - товар (або варіант) ЗАРАЗ не в наявності (stock = 0).
CREATE OR REPLACE FUNCTION public.subscribe_restock_notification(
  _tenant_id UUID,
  _product_id UUID,
  _variant_id UUID,
  _email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email TEXT := lower(btrim(_email));
  v_product_stock INT;
  v_variant_stock INT;
  v_is_active BOOLEAN;
  v_id UUID;
  v_already BOOLEAN := false;
BEGIN
  IF v_clean_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  SELECT p.stock, p.is_active INTO v_product_stock, v_is_active
  FROM public.products p
  WHERE p.id = _product_id AND p.tenant_id = _tenant_id;

  IF NOT FOUND OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
  END IF;

  IF _variant_id IS NOT NULL THEN
    SELECT v.stock INTO v_variant_stock
    FROM public.product_variants v
    WHERE v.id = _variant_id AND v.tenant_id = _tenant_id AND v.product_id = _product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'variant_not_found' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_variant_stock, 0) > 0 THEN
      RAISE EXCEPTION 'variant_in_stock' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF COALESCE(v_product_stock, 0) > 0 THEN
      RAISE EXCEPTION 'product_in_stock' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- idempotent upsert
  INSERT INTO public.restock_notifications (tenant_id, product_id, variant_id, customer_email, status)
  VALUES (_tenant_id, _product_id, _variant_id, v_clean_email, 'pending')
  ON CONFLICT (tenant_id, product_id, variant_id, customer_email)
  DO UPDATE SET status = 'pending', notified_at = NULL
  RETURNING id INTO v_id;

  -- Чи це повторна підписка? (грубо: якщо created_at < 5 сек тому — нова, інакше повторна)
  SELECT (created_at < (now() - interval '5 seconds')) INTO v_already
  FROM public.restock_notifications WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'already_subscribed', COALESCE(v_already, false));
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_restock_notification(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscribe_restock_notification(UUID, UUID, UUID, TEXT) TO anon, authenticated;