-- Розширюємо place_storefront_order, додаючи доставку та телефон у єдиний JSONB-параметр.
-- Залишаємо існуючу функцію без змін (back-compat) і додаємо новий overload.

CREATE OR REPLACE FUNCTION public.place_storefront_order(
  _tenant_id uuid,
  _customer_name text,
  _customer_email text,
  _items jsonb,
  _payment_method text DEFAULT 'manual',
  _shipping jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant public.tenants;
  _order_id uuid;
  _total_cents bigint := 0;
  _currency text := 'UAH';
  _item jsonb;
  _product public.products;
  _qty int;
  _items_count int;
  _safe_email text;
  _safe_name text;
  _safe_pm text;
  _safe_phone text;
  _shipping_addr jsonb := NULL;
  _shipping_method text := NULL;
  _shipping_cost int := 0;
BEGIN
  -- 1. Tenant
  SELECT * INTO _tenant FROM public.tenants WHERE id = _tenant_id;
  IF _tenant.id IS NULL THEN RAISE EXCEPTION 'invalid_tenant'; END IF;
  IF _tenant.status <> 'active' THEN RAISE EXCEPTION 'tenant_inactive'; END IF;

  -- 2. Items 1..50
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;
  _items_count := jsonb_array_length(_items);
  IF _items_count = 0 OR _items_count > 50 THEN
    RAISE EXCEPTION 'invalid_items_count';
  END IF;

  -- 3. Sanitize customer
  _safe_name := substr(COALESCE(NULLIF(trim(_customer_name), ''), 'Guest'), 1, 200);
  _safe_email := lower(substr(COALESCE(NULLIF(trim(_customer_email), ''), ''), 1, 200));
  IF _safe_email <> '' AND _safe_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  -- 4. Payment whitelist
  _safe_pm := CASE
    WHEN _payment_method IN ('stripe_card', 'stripe') THEN 'stripe_card'
    ELSE 'manual'
  END;

  -- 5. Парсимо shipping (опціонально)
  IF _shipping IS NOT NULL AND jsonb_typeof(_shipping) = 'object' THEN
    _safe_phone := substr(COALESCE(_shipping->>'phone', ''), 1, 32);
    _shipping_method := substr(COALESCE(_shipping->>'method', ''), 1, 32);
    IF _shipping_method NOT IN ('nova_poshta', 'pickup', '') THEN
      _shipping_method := NULL;
    END IF;
    IF _shipping_method = '' THEN _shipping_method := NULL; END IF;
    -- Зберігаємо все, що прийшло, але обмежуємо розмір (anti-DoS)
    IF length(_shipping::text) <= 4000 THEN
      _shipping_addr := _shipping;
    END IF;
  END IF;

  -- 6. Створюємо чорновий order
  INSERT INTO public.orders (
    tenant_id, customer_name, customer_email, total_cents, currency, status, payment_method,
    shipping_address, shipping_method, shipping_cost_cents
  ) VALUES (
    _tenant_id, _safe_name, NULLIF(_safe_email, ''), 0, _currency, 'pending', _safe_pm,
    _shipping_addr, _shipping_method, _shipping_cost
  ) RETURNING id INTO _order_id;

  -- 7. Items: тенант + active + stock
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'quantity')::int, 0);
    IF _qty < 1 OR _qty > 999 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;

    SELECT * INTO _product
    FROM public.products
    WHERE id = (_item->>'product_id')::uuid AND tenant_id = _tenant_id AND is_active = true;

    IF _product.id IS NULL THEN RAISE EXCEPTION 'invalid_product'; END IF;
    IF _product.stock_quantity IS NOT NULL AND _product.stock_quantity < _qty THEN
      RAISE EXCEPTION 'insufficient_stock';
    END IF;

    INSERT INTO public.order_items (order_id, tenant_id, product_id, quantity, unit_price_cents, total_cents)
    VALUES (_order_id, _tenant_id, _product.id, _qty, _product.price_cents, _product.price_cents * _qty);

    _total_cents := _total_cents + (_product.price_cents::bigint * _qty);

    -- Зменшуємо stock якщо trackable
    IF _product.stock_quantity IS NOT NULL THEN
      UPDATE public.products
      SET stock_quantity = stock_quantity - _qty
      WHERE id = _product.id;
    END IF;
  END LOOP;

  -- 8. Оновлюємо total
  UPDATE public.orders SET total_cents = _total_cents WHERE id = _order_id;

  RETURN _order_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.place_storefront_order(uuid, text, text, jsonb, text, jsonb) TO anon, authenticated;