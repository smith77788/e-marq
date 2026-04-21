
-- ============================================================================
-- 1) tenant_configs: видалити публічний read, додати safe storefront function
-- ============================================================================
DROP POLICY IF EXISTS "tenant_configs_public_read" ON public.tenant_configs;

CREATE POLICY "tenant_configs_member_read"
  ON public.tenant_configs
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- Безпечна публічна функція: лише поля для вітрини (без bot, без owner_telegram_chat_id)
CREATE OR REPLACE FUNCTION public.get_storefront_config(_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _cfg public.tenant_configs;
  _features jsonb;
  _payments jsonb;
BEGIN
  SELECT id INTO _tenant_id
  FROM public.tenants
  WHERE slug = _slug AND status = 'active'
  LIMIT 1;
  IF _tenant_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _cfg FROM public.tenant_configs WHERE tenant_id = _tenant_id;
  _features := COALESCE(_cfg.features, '{}'::jsonb);
  -- Тільки безпечна частина features: payments
  _payments := COALESCE(_features -> 'payments', '{}'::jsonb);

  RETURN jsonb_build_object(
    'tenant_id', _tenant_id,
    'brand_name', COALESCE(_cfg.brand_name, ''),
    'ui', COALESCE(_cfg.ui, '{}'::jsonb),
    'seo', COALESCE(_cfg.seo, '{}'::jsonb),
    'features', jsonb_build_object('payments', _payments)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_storefront_config(text) TO anon, authenticated;

-- ============================================================================
-- 2) orders / order_items: закрити публічний INSERT, дати функцію place_storefront_order
-- ============================================================================
DROP POLICY IF EXISTS "orders_insert_public" ON public.orders;
DROP POLICY IF EXISTS "order_items_insert_public" ON public.order_items;

CREATE POLICY "orders_insert_members"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "order_items_insert_members"
  ON public.order_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.tenant_id = order_items.tenant_id
        AND public.is_tenant_member(o.tenant_id)
    )
  );

-- Безпечна public функція оформлення замовлення з вітрини (анонім).
-- Сервер сам рахує total_cents з products.price_cents, не довіряючи клієнту.
CREATE OR REPLACE FUNCTION public.place_storefront_order(
  _tenant_id uuid,
  _customer_name text,
  _customer_email text,
  _items jsonb,                 -- [{product_id: uuid, quantity: int}]
  _payment_method text DEFAULT 'manual'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  -- 1. Tenant існує і активний
  SELECT * INTO _tenant FROM public.tenants WHERE id = _tenant_id;
  IF _tenant.id IS NULL THEN RAISE EXCEPTION 'invalid_tenant'; END IF;
  IF _tenant.status <> 'active' THEN RAISE EXCEPTION 'tenant_inactive'; END IF;

  -- 2. Валідація items: 1..50 позицій
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

  -- 4. Payment method whitelist
  _safe_pm := CASE
    WHEN _payment_method IN ('stripe_card', 'stripe') THEN 'stripe_card'
    ELSE 'manual'
  END;

  -- 5. Створюємо чорновий order (з нульовою сумою — оновимо)
  INSERT INTO public.orders (
    tenant_id, customer_name, customer_email, total_cents, currency, status, payment_method
  ) VALUES (
    _tenant_id, _safe_name, NULLIF(_safe_email, ''), 0, _currency, 'pending', _safe_pm
  ) RETURNING id INTO _order_id;

  -- 6. Додаємо items: для кожного перевіряємо product належить tenant + active + stock
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := GREATEST(1, LEAST(100, COALESCE((_item ->> 'quantity')::int, 1)));
    SELECT * INTO _product
    FROM public.products
    WHERE id = (_item ->> 'product_id')::uuid
      AND tenant_id = _tenant_id
      AND is_active = true;
    IF _product.id IS NULL THEN
      -- відкат і помилка
      DELETE FROM public.orders WHERE id = _order_id;
      RAISE EXCEPTION 'invalid_product:%', (_item ->> 'product_id');
    END IF;
    IF _product.stock IS NOT NULL AND _product.stock < _qty THEN
      DELETE FROM public.orders WHERE id = _order_id;
      RAISE EXCEPTION 'insufficient_stock:%', _product.id;
    END IF;
    _currency := _product.currency;

    INSERT INTO public.order_items (order_id, tenant_id, product_id, product_name, quantity, unit_price_cents)
    VALUES (_order_id, _tenant_id, _product.id, _product.name, _qty, _product.price_cents);

    _total_cents := _total_cents + (_product.price_cents::bigint * _qty);
  END LOOP;

  -- 7. Захист від overflow / небезпечних сум
  IF _total_cents <= 0 OR _total_cents > 100000000 THEN
    DELETE FROM public.orders WHERE id = _order_id;
    RAISE EXCEPTION 'invalid_total';
  END IF;

  UPDATE public.orders
  SET total_cents = _total_cents::int, currency = _currency
  WHERE id = _order_id;

  RETURN _order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_storefront_order(uuid, text, text, jsonb, text) TO anon, authenticated;

-- ============================================================================
-- 3) events: тригер-валідатор (whitelist типів, tenant active, обмеження)
-- ============================================================================
DROP POLICY IF EXISTS "events_insert_public" ON public.events;

-- Дозволяємо INSERT але через тригер валідуємо
CREATE POLICY "events_insert_validated"
  ON public.events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.validate_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_status text;
BEGIN
  -- 1. Tenant exists and active
  SELECT status::text INTO _tenant_status FROM public.tenants WHERE id = NEW.tenant_id;
  IF _tenant_status IS NULL THEN RAISE EXCEPTION 'invalid_tenant'; END IF;
  IF _tenant_status <> 'active' THEN RAISE EXCEPTION 'tenant_inactive'; END IF;

  -- 2. Whitelist event types (відомі бізнес-події)
  IF NEW.type::text NOT IN (
    'page_viewed','content_viewed','product_viewed','add_to_cart',
    'checkout_started','purchase_completed','search','signup',
    'login','order_created','order_paid','message_sent','message_opened','message_clicked'
  ) THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;

  -- 3. Захист від bloat payload
  IF NEW.payload IS NOT NULL AND length(NEW.payload::text) > 10000 THEN
    RAISE EXCEPTION 'payload_too_large';
  END IF;

  -- 4. Якщо product_id заданий — він мусить належати tenant
  IF NEW.product_id IS NOT NULL THEN
    PERFORM 1 FROM public.products WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'product_tenant_mismatch'; END IF;
  END IF;
  IF NEW.order_id IS NOT NULL THEN
    PERFORM 1 FROM public.orders WHERE id = NEW.order_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'order_tenant_mismatch'; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_event_insert ON public.events;
CREATE TRIGGER trg_validate_event_insert
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.validate_event_insert();

-- ============================================================================
-- 4) conversations: лише members + service-role (через webhook hooks)
-- ============================================================================
DROP POLICY IF EXISTS "conversations_insert_public" ON public.conversations;

CREATE POLICY "conversations_insert_members"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- ============================================================================
-- 5) search_queries: тригер-валідатор (tenant active + sanitize)
-- ============================================================================
DROP POLICY IF EXISTS "search_q_insert_public" ON public.search_queries;

CREATE POLICY "search_queries_insert_validated"
  ON public.search_queries
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.validate_search_query_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _status text;
BEGIN
  SELECT status::text INTO _status FROM public.tenants WHERE id = NEW.tenant_id;
  IF _status IS NULL OR _status <> 'active' THEN RAISE EXCEPTION 'invalid_or_inactive_tenant'; END IF;
  IF NEW.query IS NULL OR length(NEW.query) > 500 THEN RAISE EXCEPTION 'invalid_query_length'; END IF;
  NEW.query := substr(NEW.query, 1, 500);
  IF NEW.source IS NOT NULL AND NEW.source NOT IN ('web','app','telegram','viber','sms','email','api') THEN
    NEW.source := 'web';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_search_query_insert ON public.search_queries;
CREATE TRIGGER trg_validate_search_query_insert
  BEFORE INSERT ON public.search_queries
  FOR EACH ROW EXECUTE FUNCTION public.validate_search_query_insert();

-- ============================================================================
-- 6) ugc_items: лише members (відгуки клієнтів — через окрему функцію пізніше)
-- ============================================================================
DROP POLICY IF EXISTS "ugc_insert_public" ON public.ugc_items;

CREATE POLICY "ugc_items_insert_members"
  ON public.ugc_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_tenant_member(tenant_id)
    -- Дозволяємо клієнту з валідним customer_id залишити свій відгук:
    OR EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = ugc_items.customer_id
        AND c.tenant_id = ugc_items.tenant_id
        AND c.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 7) Rate limiting для webhook (інтеграції) — таблиця для лічильника
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.integration_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  bucket_minute timestamptz NOT NULL,    -- date_trunc('minute', now())
  request_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider, bucket_minute)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_bucket ON public.integration_rate_limits(bucket_minute);

ALTER TABLE public.integration_rate_limits ENABLE ROW LEVEL SECURITY;

-- Тільки super-admin може дивитись (для діагностики)
CREATE POLICY "rate_limits_super_admin_select"
  ON public.integration_rate_limits
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Функція: інкрементує лічильник, повертає поточну кількість за хвилину
-- Якщо > _max_per_minute — повертає -1 (rate-limit exceeded)
CREATE OR REPLACE FUNCTION public.increment_integration_rate_limit(
  _tenant_id uuid,
  _provider text,
  _max_per_minute int DEFAULT 60
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bucket timestamptz := date_trunc('minute', now());
  _new_count int;
BEGIN
  INSERT INTO public.integration_rate_limits (tenant_id, provider, bucket_minute, request_count)
  VALUES (_tenant_id, _provider, _bucket, 1)
  ON CONFLICT (tenant_id, provider, bucket_minute)
  DO UPDATE SET request_count = public.integration_rate_limits.request_count + 1
  RETURNING request_count INTO _new_count;

  IF _new_count > _max_per_minute THEN
    RETURN -1;
  END IF;
  RETURN _new_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_integration_rate_limit(uuid, text, int) FROM PUBLIC, anon, authenticated;
-- Тільки service-role може кликати з server-side коду
