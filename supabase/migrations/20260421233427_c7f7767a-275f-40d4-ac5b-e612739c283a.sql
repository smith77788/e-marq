
-- 1) validate_loyalty_redeem: перевірка можливості списання балів
CREATE OR REPLACE FUNCTION public.validate_loyalty_redeem(
  _tenant_id uuid,
  _customer_email text,
  _redeem_points integer,
  _order_total_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program loyalty_programs%ROWTYPE;
  v_account loyalty_accounts%ROWTYPE;
  v_uah_per_point numeric;
  v_max_discount_cents integer;
  v_requested_discount_cents integer;
  v_normalized_email text;
BEGIN
  IF _redeem_points IS NULL OR _redeem_points <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_points');
  END IF;

  v_normalized_email := lower(trim(coalesce(_customer_email, '')));
  IF v_normalized_email = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_email');
  END IF;

  SELECT * INTO v_program
  FROM loyalty_programs
  WHERE tenant_id = _tenant_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'program_inactive');
  END IF;

  IF _redeem_points < v_program.min_redeem_points THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'below_min_redeem',
      'min_points', v_program.min_redeem_points
    );
  END IF;

  SELECT * INTO v_account
  FROM loyalty_accounts
  WHERE tenant_id = _tenant_id AND customer_email = v_normalized_email;

  IF NOT FOUND OR v_account.balance_points < _redeem_points THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'insufficient_balance',
      'balance_points', COALESCE(v_account.balance_points, 0)
    );
  END IF;

  v_uah_per_point := v_program.uah_per_point;  -- грн за 1 бал
  -- discount у копійках = points * uah_per_point * 100
  v_requested_discount_cents := floor(_redeem_points * v_uah_per_point * 100)::integer;
  -- макс 50% від замовлення
  v_max_discount_cents := floor(_order_total_cents * 0.5)::integer;
  IF v_requested_discount_cents > v_max_discount_cents THEN
    v_requested_discount_cents := v_max_discount_cents;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'discount_cents', v_requested_discount_cents,
    'points_used', _redeem_points,
    'balance_after', v_account.balance_points - _redeem_points
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_loyalty_redeem(uuid, text, integer, integer) TO anon, authenticated;

-- 2) award_loyalty_points_on_paid: тригер на оплату
CREATE OR REPLACE FUNCTION public.award_loyalty_points_on_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program loyalty_programs%ROWTYPE;
  v_account_id uuid;
  v_email text;
  v_points integer;
  v_subtotal_uah numeric;
  v_new_lifetime integer;
  v_new_tier text;
BEGIN
  -- спрацьовуємо лише коли paid_at вперше виставляється
  IF NEW.paid_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.paid_at IS NOT NULL THEN RETURN NEW; END IF;

  v_email := lower(trim(coalesce(NEW.customer_email, '')));
  IF v_email = '' THEN RETURN NEW; END IF;

  SELECT * INTO v_program
  FROM loyalty_programs
  WHERE tenant_id = NEW.tenant_id AND is_active = true;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- бали = points_per_100_uah * (total / 10000 копійок)
  v_subtotal_uah := COALESCE(NEW.subtotal_cents, NEW.total_cents, 0) / 100.0;
  v_points := floor(v_program.points_per_100_uah * (v_subtotal_uah / 100.0))::integer;
  IF v_points <= 0 THEN RETURN NEW; END IF;

  -- upsert account
  INSERT INTO loyalty_accounts (tenant_id, customer_email, balance_points, lifetime_points)
  VALUES (NEW.tenant_id, v_email, v_points, v_points)
  ON CONFLICT (tenant_id, customer_email) DO UPDATE
    SET balance_points = loyalty_accounts.balance_points + EXCLUDED.balance_points,
        lifetime_points = loyalty_accounts.lifetime_points + EXCLUDED.lifetime_points,
        updated_at = now()
  RETURNING id, lifetime_points INTO v_account_id, v_new_lifetime;

  -- оновлення tier
  v_new_tier := 'bronze';
  IF v_new_lifetime >= 5000 THEN v_new_tier := 'platinum';
  ELSIF v_new_lifetime >= 2000 THEN v_new_tier := 'gold';
  ELSIF v_new_lifetime >= 500 THEN v_new_tier := 'silver';
  END IF;

  UPDATE loyalty_accounts
  SET tier = v_new_tier
  WHERE id = v_account_id AND tier <> v_new_tier;

  -- транзакція
  INSERT INTO loyalty_transactions (tenant_id, account_id, order_id, type, points, description)
  VALUES (NEW.tenant_id, v_account_id, NEW.id, 'earn', v_points,
          format('Нараховано за замовлення на %s грн', round(v_subtotal_uah, 2)));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_loyalty_award ON public.orders;
CREATE TRIGGER trg_orders_loyalty_award
AFTER UPDATE OF paid_at ON public.orders
FOR EACH ROW
WHEN (NEW.paid_at IS NOT NULL AND OLD.paid_at IS DISTINCT FROM NEW.paid_at)
EXECUTE FUNCTION public.award_loyalty_points_on_paid();

-- 3) розширення place_storefront_order: додаємо _loyalty_redeem_points
CREATE OR REPLACE FUNCTION public.place_storefront_order(
  _tenant_id uuid,
  _customer_name text,
  _customer_email text,
  _items jsonb,
  _payment_method text DEFAULT 'manual',
  _shipping jsonb DEFAULT NULL,
  _promo_code text DEFAULT NULL,
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
  v_promo_id uuid := NULL;
  v_promo_discount_cents integer := 0;
  v_loyalty_discount_cents integer := 0;
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

  -- subtotal + stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM products
    WHERE id = (v_item->>'product_id')::uuid AND tenant_id = _tenant_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_product'; END IF;
    v_qty := COALESCE((v_item->>'quantity')::integer, 1);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    IF v_product.stock < v_qty THEN RAISE EXCEPTION 'insufficient_stock'; END IF;
    v_line_cents := v_product.price_cents * v_qty;
    v_subtotal_cents := v_subtotal_cents + v_line_cents;
    v_currency := v_product.currency;
  END LOOP;

  -- promo
  IF _promo_code IS NOT NULL AND length(trim(_promo_code)) > 0 THEN
    SELECT id INTO v_promo_id FROM promotions
    WHERE tenant_id = _tenant_id AND code = upper(trim(_promo_code))
      AND is_active = true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (ends_at IS NULL OR ends_at >= now())
    LIMIT 1;
    -- спрощено: не перераховуємо знижку promo тут (validate_discount_code робить це)
  END IF;

  -- loyalty redeem
  IF _loyalty_redeem_points IS NOT NULL AND _loyalty_redeem_points > 0 THEN
    v_validation := validate_loyalty_redeem(_tenant_id, v_email, _loyalty_redeem_points, v_subtotal_cents);
    IF (v_validation->>'valid')::boolean THEN
      v_loyalty_discount_cents := (v_validation->>'discount_cents')::integer;
      v_loyalty_points_used := (v_validation->>'points_used')::integer;
      SELECT id INTO v_loyalty_account_id FROM loyalty_accounts
      WHERE tenant_id = _tenant_id AND customer_email = v_email;
    END IF;
  END IF;

  v_total_cents := GREATEST(0, v_subtotal_cents - v_promo_discount_cents - v_loyalty_discount_cents);

  -- create order
  INSERT INTO orders (
    tenant_id, customer_name, customer_email,
    subtotal_cents, total_cents, currency,
    status, payment_method, payment_status,
    shipping_address, promo_code, discount_cents,
    metadata
  ) VALUES (
    _tenant_id, _customer_name, v_email,
    v_subtotal_cents, v_total_cents, v_currency,
    'pending', _payment_method, 'pending',
    _shipping, NULLIF(upper(trim(_promo_code)), ''), v_promo_discount_cents + v_loyalty_discount_cents,
    jsonb_build_object(
      'loyalty_points_redeemed', v_loyalty_points_used,
      'loyalty_discount_cents', v_loyalty_discount_cents
    )
  ) RETURNING id INTO v_order_id;

  -- order_items
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::integer, 1);
    INSERT INTO order_items (order_id, tenant_id, product_id, name, sku, quantity, unit_price_cents, total_cents)
    VALUES (v_order_id, _tenant_id, v_product.id, v_product.name, v_product.sku, v_qty,
            v_product.price_cents, v_product.price_cents * v_qty);
    UPDATE products SET stock = stock - v_qty WHERE id = v_product.id;
  END LOOP;

  -- record loyalty redeem (negative points) immediately
  IF v_loyalty_points_used > 0 AND v_loyalty_account_id IS NOT NULL THEN
    UPDATE loyalty_accounts
    SET balance_points = balance_points - v_loyalty_points_used,
        updated_at = now()
    WHERE id = v_loyalty_account_id;

    INSERT INTO loyalty_transactions (tenant_id, account_id, order_id, type, points, description)
    VALUES (_tenant_id, v_loyalty_account_id, v_order_id, 'redeem', -v_loyalty_points_used,
            format('Списано при оформленні замовлення'));
  END IF;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_storefront_order(uuid, text, text, jsonb, text, jsonb, text, integer) TO anon, authenticated;
