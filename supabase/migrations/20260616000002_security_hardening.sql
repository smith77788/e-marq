-- ============================================================
-- Security hardening (35+ findings audit)
--
-- Changes:
--   1. orders.access_token — per-order bearer token so the public
--      order-status page cannot be scraped by uuid enumeration.
--   2. get_public_order_v2 — requires matching access_token.
--      Revoke anon from old get_public_order (returns PII).
--   3. place_storefront_order — remove _promo_discount_cents
--      parameter (was trusted from client); recalculate server-side.
--      Atomic stock decrement prevents oversell race.
--      Returns jsonb {order_id, access_token} instead of uuid.
--   4. Also increments promotions.times_used (pre-existing bug fix).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Add access_token to orders
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS access_token uuid NOT NULL DEFAULT gen_random_uuid();


-- ─────────────────────────────────────────────────────────────
-- 2. get_public_order_v2 — token-gated, anon-safe
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_order_v2(
  _order_id    uuid,
  _access_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _order  public.orders;
  _items  jsonb;
  _config jsonb;
  _tenant jsonb;
BEGIN
  SELECT * INTO _order
  FROM public.orders
  WHERE id = _order_id AND access_token = _access_token;

  IF NOT FOUND THEN
    RETURN NULL;  -- same response for wrong token vs not-found (avoid oracle)
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',               oi.id,
      'product_name',     oi.product_name,
      'quantity',         oi.quantity,
      'unit_price_cents', oi.unit_price_cents
    ) ORDER BY oi.created_at
  ) INTO _items
  FROM public.order_items oi
  WHERE oi.order_id = _order_id;

  SELECT jsonb_build_object(
    'id',   t.id,
    'slug', t.slug,
    'name', t.name
  ) INTO _tenant
  FROM public.tenants t
  WHERE t.id = _order.tenant_id;

  SELECT jsonb_build_object(
    'brand_name', tc.brand_name,
    'features',   tc.features
  ) INTO _config
  FROM public.tenant_configs tc
  WHERE tc.tenant_id = _order.tenant_id;

  RETURN jsonb_build_object(
    'order', jsonb_build_object(
      'id',             _order.id,
      'status',         _order.status,
      'payment_method', _order.payment_method,
      'payment_ref',    _order.payment_ref,
      'total_cents',    _order.total_cents,
      'currency',       _order.currency,
      'customer_email', _order.customer_email,
      'customer_name',  _order.customer_name,
      'created_at',     _order.created_at,
      'paid_at',        _order.paid_at,
      'tenant_id',      _order.tenant_id
    ),
    'items',  COALESCE(_items, '[]'::jsonb),
    'tenant', _tenant,
    'config', _config
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_order_v2(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_order_v2(uuid, uuid) TO anon, authenticated;

-- Revoke anon from old function — it returns PII without auth
REVOKE EXECUTE ON FUNCTION public.get_public_order(uuid) FROM anon;


-- ─────────────────────────────────────────────────────────────
-- 3. place_storefront_order — server-side promo + atomic stock
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_storefront_order(
  _tenant_id             uuid,
  _customer_name         text,
  _customer_email        text,
  _items                 jsonb,
  _payment_method        text    DEFAULT 'manual',
  _shipping              jsonb   DEFAULT NULL,
  _promo_code            text    DEFAULT NULL,
  _loyalty_redeem_points integer DEFAULT NULL
)
RETURNS jsonb   -- {order_id, access_token}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id              uuid;
  v_access_token          uuid;
  v_subtotal_cents        integer := 0;
  v_total_cents           integer;
  v_currency              text    := 'UAH';
  v_item                  jsonb;
  v_product               products%ROWTYPE;
  v_qty                   integer;
  v_email                 text;
  v_loyalty_discount_cents integer := 0;
  v_promo_discount_cents  integer := 0;
  v_total_discount_cents  integer := 0;
  v_loyalty_points_used   integer := 0;
  v_loyalty_account_id    uuid    := NULL;
  v_validation            jsonb;
  v_tenant_status         text;
  v_promo                 promotions%ROWTYPE;
  v_rows_updated          integer;
BEGIN
  -- tenant check
  SELECT status INTO v_tenant_status FROM tenants WHERE id = _tenant_id;
  IF v_tenant_status IS NULL THEN RAISE EXCEPTION 'invalid_tenant'; END IF;
  IF v_tenant_status <> 'active' THEN RAISE EXCEPTION 'tenant_inactive'; END IF;

  -- email
  v_email := lower(trim(coalesce(_customer_email, '')));
  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  -- items
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;
  IF jsonb_array_length(_items) = 0 OR jsonb_array_length(_items) > 50 THEN
    RAISE EXCEPTION 'invalid_items_count';
  END IF;

  -- compute subtotal (stock check deferred to atomic decrement)
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM products
    WHERE id = (v_item->>'product_id')::uuid AND tenant_id = _tenant_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_product'; END IF;
    v_qty := COALESCE((v_item->>'quantity')::integer, 1);
    IF v_qty <= 0 OR v_qty > 999 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    v_subtotal_cents := v_subtotal_cents + (v_product.price_cents * v_qty);
    v_currency       := v_product.currency;
  END LOOP;

  -- server-side promo re-validation (never trust client-supplied discount amount)
  IF _promo_code IS NOT NULL AND trim(_promo_code) <> '' THEN
    SELECT * INTO v_promo FROM promotions
    WHERE tenant_id = _tenant_id
      AND UPPER(code) = UPPER(trim(_promo_code))
      AND is_active = true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (ends_at IS NULL   OR ends_at   >= now())
      AND (usage_limit IS NULL OR times_used < usage_limit)
    LIMIT 1;

    IF v_promo.id IS NOT NULL THEN
      IF v_promo.promo_type = 'percent_off' THEN
        v_promo_discount_cents := (v_subtotal_cents * v_promo.value::numeric / 100)::integer;
      ELSIF v_promo.promo_type = 'fixed_off' THEN
        v_promo_discount_cents := LEAST((v_promo.value::integer) * 100, v_subtotal_cents);
      END IF;
      v_promo_discount_cents := LEAST(v_promo_discount_cents, v_subtotal_cents);
    END IF;
  END IF;

  -- loyalty redeem validation
  IF _loyalty_redeem_points IS NOT NULL AND _loyalty_redeem_points > 0 THEN
    v_validation := validate_loyalty_redeem(
      _tenant_id, v_email, _loyalty_redeem_points,
      GREATEST(0, v_subtotal_cents - v_promo_discount_cents)
    );
    IF (v_validation->>'valid')::boolean THEN
      v_loyalty_discount_cents := (v_validation->>'discount_cents')::integer;
      v_loyalty_points_used    := (v_validation->>'points_used')::integer;
      SELECT id INTO v_loyalty_account_id FROM loyalty_accounts
      WHERE tenant_id = _tenant_id AND customer_email = v_email;
    END IF;
  END IF;

  v_total_discount_cents := v_promo_discount_cents + v_loyalty_discount_cents;
  v_total_cents          := GREATEST(0, v_subtotal_cents - v_total_discount_cents);

  -- create order; access_token auto-generated via column DEFAULT
  INSERT INTO orders (
    tenant_id, customer_name, customer_email,
    subtotal_cents, total_cents, currency,
    status, payment_method, payment_status,
    shipping_address, promo_code, discount_cents,
    metadata
  ) VALUES (
    _tenant_id,
    substr(coalesce(nullif(trim(_customer_name), ''), 'Guest'), 1, 200),
    v_email,
    v_subtotal_cents, v_total_cents, v_currency,
    'pending', _payment_method, 'pending',
    _shipping,
    NULLIF(upper(trim(coalesce(_promo_code, ''))), ''),
    v_total_discount_cents,
    jsonb_build_object(
      'promo_code',              NULLIF(upper(trim(coalesce(_promo_code, ''))), ''),
      'promo_discount_cents',    v_promo_discount_cents,
      'loyalty_points_redeemed', v_loyalty_points_used,
      'loyalty_discount_cents',  v_loyalty_discount_cents,
      'total_discount_cents',    v_total_discount_cents
    )
  ) RETURNING id, access_token INTO v_order_id, v_access_token;

  -- order_items + ATOMIC stock decrement (prevents oversell race condition)
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM products
    WHERE id = (v_item->>'product_id')::uuid AND tenant_id = _tenant_id;
    v_qty := COALESCE((v_item->>'quantity')::integer, 1);

    INSERT INTO order_items (
      order_id, tenant_id, product_id, product_name, sku,
      quantity, unit_price_cents, total_cents
    ) VALUES (
      v_order_id, _tenant_id, v_product.id, v_product.name, v_product.sku,
      v_qty, v_product.price_cents, v_product.price_cents * v_qty
    );

    IF v_product.stock IS NOT NULL THEN
      UPDATE products
        SET stock = stock - v_qty
      WHERE id = v_product.id AND stock >= v_qty;
      GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
      IF v_rows_updated = 0 THEN
        RAISE EXCEPTION 'insufficient_stock';
      END IF;
    END IF;
  END LOOP;

  -- increment promotion usage counter (fixes pre-existing bug: was never incremented)
  IF v_promo.id IS NOT NULL THEN
    UPDATE promotions
      SET times_used = times_used + 1, updated_at = now()
    WHERE id = v_promo.id;
  END IF;

  -- debit loyalty points
  IF v_loyalty_points_used > 0 AND v_loyalty_account_id IS NOT NULL THEN
    UPDATE loyalty_accounts
      SET balance_points = balance_points - v_loyalty_points_used, updated_at = now()
    WHERE id = v_loyalty_account_id AND balance_points >= v_loyalty_points_used;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated > 0 THEN
      INSERT INTO loyalty_transactions (
        tenant_id, account_id, order_id, type, points, description
      ) VALUES (
        _tenant_id, v_loyalty_account_id, v_order_id, 'redeem', -v_loyalty_points_used,
        'Списано при оформленні замовлення'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('order_id', v_order_id, 'access_token', v_access_token);
END;
$$;

-- Grant for new 8-param signature
GRANT EXECUTE ON FUNCTION public.place_storefront_order(uuid, text, text, jsonb, text, jsonb, text, integer)
  TO anon, authenticated;

-- Revoke anon from old 9-param signature (had _promo_discount_cents)
REVOKE EXECUTE ON FUNCTION public.place_storefront_order(uuid, text, text, jsonb, text, jsonb, text, integer, integer)
  FROM anon;
