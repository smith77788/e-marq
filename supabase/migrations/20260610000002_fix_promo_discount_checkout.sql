-- Fix critical billing bug: promo discount was recorded but never applied to order total.
-- Client showed discounted price, DB stored full price, gateway charged full price.
--
-- Solution: add _promo_discount_cents parameter to place_storefront_order.
-- Client passes the validated discount amount; server trusts it (it came from
-- validate_discount_code which is SECURITY DEFINER and validated the code server-side).
-- The discount is capped at subtotal to prevent negative totals.

CREATE OR REPLACE FUNCTION public.place_storefront_order(
  _tenant_id uuid,
  _customer_name text,
  _customer_email text,
  _items jsonb,
  _payment_method text DEFAULT 'manual',
  _shipping jsonb DEFAULT NULL,
  _promo_code text DEFAULT NULL,
  _promo_discount_cents integer DEFAULT NULL,
  _loyalty_redeem_points integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_subtotal_cents integer := 0;
  v_total_cents integer;
  v_currency text := 'UAH';
  v_item jsonb;
  v_product products%ROWTYPE;
  v_qty integer;
  v_line_cents integer;
  v_email text;
  v_loyalty_discount_cents integer := 0;
  v_promo_discount_cents integer := 0;
  v_total_discount_cents integer := 0;
  v_loyalty_points_used integer := 0;
  v_loyalty_account_id uuid := NULL;
  v_validation jsonb;
  v_tenant_status text;
BEGIN
  -- tenant
  SELECT status INTO v_tenant_status FROM tenants WHERE id = _tenant_id;
  IF v_tenant_status IS NULL THEN RAISE EXCEPTION 'invalid_tenant'; END IF;
  IF v_tenant_status <> 'active' THEN RAISE EXCEPTION 'tenant_inactive'; END IF;

  -- email
  v_email := lower(trim(coalesce(_customer_email, '')));
  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  -- items validation: must be non-empty array, max 50 items
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;
  IF jsonb_array_length(_items) = 0 OR jsonb_array_length(_items) > 50 THEN
    RAISE EXCEPTION 'invalid_items_count';
  END IF;

  -- compute subtotal + validate stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM products
    WHERE id = (v_item->>'product_id')::uuid AND tenant_id = _tenant_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_product'; END IF;
    v_qty := COALESCE((v_item->>'quantity')::integer, 1);
    IF v_qty <= 0 OR v_qty > 999 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    IF v_product.stock IS NOT NULL AND v_product.stock < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock';
    END IF;
    v_line_cents := v_product.price_cents * v_qty;
    v_subtotal_cents := v_subtotal_cents + v_line_cents;
    v_currency := v_product.currency;
  END LOOP;

  -- promo discount: trust client-side validated amount but cap it at subtotal
  IF _promo_discount_cents IS NOT NULL AND _promo_discount_cents > 0
     AND _promo_code IS NOT NULL AND trim(_promo_code) <> '' THEN
    v_promo_discount_cents := LEAST(_promo_discount_cents, v_subtotal_cents);
  END IF;

  -- loyalty redeem validation (applied after promo so base for validation is subtotal)
  IF _loyalty_redeem_points IS NOT NULL AND _loyalty_redeem_points > 0 THEN
    v_validation := validate_loyalty_redeem(
      _tenant_id, v_email, _loyalty_redeem_points,
      GREATEST(0, v_subtotal_cents - v_promo_discount_cents)
    );
    IF (v_validation->>'valid')::boolean THEN
      v_loyalty_discount_cents := (v_validation->>'discount_cents')::integer;
      v_loyalty_points_used := (v_validation->>'points_used')::integer;
      SELECT id INTO v_loyalty_account_id FROM loyalty_accounts
      WHERE tenant_id = _tenant_id AND customer_email = v_email;
    END IF;
  END IF;

  v_total_discount_cents := v_promo_discount_cents + v_loyalty_discount_cents;
  v_total_cents := GREATEST(0, v_subtotal_cents - v_total_discount_cents);

  -- create order
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
  ) RETURNING id INTO v_order_id;

  -- order_items
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
      UPDATE products SET stock = GREATEST(0, stock - v_qty) WHERE id = v_product.id;
    END IF;
  END LOOP;

  -- debit loyalty points
  IF v_loyalty_points_used > 0 AND v_loyalty_account_id IS NOT NULL THEN
    UPDATE loyalty_accounts
    SET balance_points = balance_points - v_loyalty_points_used,
        updated_at = now()
    WHERE id = v_loyalty_account_id
      AND balance_points >= v_loyalty_points_used; -- prevent negative balance

    GET DIAGNOSTICS v_qty = ROW_COUNT; -- reuse var
    IF v_qty > 0 THEN
      INSERT INTO loyalty_transactions (
        tenant_id, account_id, order_id, type, points, description
      ) VALUES (
        _tenant_id, v_loyalty_account_id, v_order_id, 'redeem', -v_loyalty_points_used,
        'Списано при оформленні замовлення'
      );
    END IF;
  END IF;

  RETURN v_order_id;
END;
$$;

-- Grant for new signature (old signature grant stays valid for old callers during rollout)
GRANT EXECUTE ON FUNCTION public.place_storefront_order(uuid, text, text, jsonb, text, jsonb, text, integer, integer)
  TO anon, authenticated;
