
-- Phase 1: New tenants ship as active (not pending) so owners can use the
-- product immediately. Verification becomes a bonus badge, not a gate.
CREATE OR REPLACE FUNCTION public.create_my_tenant(_name text, _slug text)
 RETURNS tenants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  clean_slug text;
  new_row public.tenants;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF _name IS NULL OR length(btrim(_name)) < 2 THEN
    RAISE EXCEPTION 'name_too_short';
  END IF;

  clean_slug := lower(regexp_replace(coalesce(_slug, ''), '[^a-z0-9-]', '', 'g'));
  IF length(clean_slug) < 2 THEN
    RAISE EXCEPTION 'slug_too_short';
  END IF;

  -- Self-serve: auto-active. verification_requested_at is still set so
  -- super-admins can later mark a brand as "Verified" for higher limits.
  INSERT INTO public.tenants (
    name, slug, owner_user_id, status,
    verification_requested_at, verified_at, verified_by
  )
  VALUES (
    btrim(_name),
    clean_slug,
    uid,
    'active'::tenant_status,
    now(),
    NULL,
    NULL
  )
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$function$;

-- Phase 4: One-click demo seed so a new owner sees a populated dashboard
-- instantly. Marks rows with metadata.demo='true' so we can clear later.
CREATE OR REPLACE FUNCTION public.seed_demo_catalog(_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_owner boolean;
  is_admin boolean;
  prod_count int;
  pid_a uuid; pid_b uuid; pid_c uuid; pid_d uuid; pid_e uuid; pid_f uuid;
  cid_a uuid; cid_b uuid; cid_c uuid;
  oid uuid;
  i int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant_id AND owner_user_id=uid)
    INTO is_owner;
  SELECT public.has_role(uid, 'super_admin'::app_role) INTO is_admin;
  IF NOT (is_owner OR is_admin) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT count(*) INTO prod_count FROM public.products WHERE tenant_id=_tenant_id;
  IF prod_count > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'tenant_has_products');
  END IF;

  -- Products
  INSERT INTO public.products (tenant_id, name, price_cents, stock, is_active, metadata)
  VALUES
    (_tenant_id, 'Демо · Кава Lavazza 1кг', 49900, 24, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Чай Earl Grey 100г', 18900, 40, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Шоколад темний 70%', 12500, 60, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Печиво вівсяне 200г', 8900, 35, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Сироп ванільний', 22500, 12, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Френч-прес 600мл', 59000, 8, true, '{"demo":"true"}'::jsonb)
  RETURNING id INTO pid_a;
  -- pick the inserted ids in stable order
  SELECT id INTO pid_a FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Кава Lavazza 1кг' LIMIT 1;
  SELECT id INTO pid_b FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Чай Earl Grey 100г' LIMIT 1;
  SELECT id INTO pid_c FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Шоколад темний 70%' LIMIT 1;
  SELECT id INTO pid_d FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Печиво вівсяне 200г' LIMIT 1;
  SELECT id INTO pid_e FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Сироп ванільний' LIMIT 1;
  SELECT id INTO pid_f FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Френч-прес 600мл' LIMIT 1;

  -- Customers
  INSERT INTO public.customers (tenant_id, email, name, metadata)
  VALUES
    (_tenant_id, 'demo.alice@example.com', 'Аліса (демо)', '{"demo":"true"}'::jsonb),
    (_tenant_id, 'demo.bob@example.com', 'Богдан (демо)', '{"demo":"true"}'::jsonb),
    (_tenant_id, 'demo.carol@example.com', 'Кароліна (демо)', '{"demo":"true"}'::jsonb)
  ON CONFLICT (tenant_id, email) DO NOTHING;
  SELECT id INTO cid_a FROM public.customers WHERE tenant_id=_tenant_id AND email='demo.alice@example.com';
  SELECT id INTO cid_b FROM public.customers WHERE tenant_id=_tenant_id AND email='demo.bob@example.com';
  SELECT id INTO cid_c FROM public.customers WHERE tenant_id=_tenant_id AND email='demo.carol@example.com';

  -- 5 paid orders over the last 14 days
  FOR i IN 0..4 LOOP
    INSERT INTO public.orders (
      tenant_id, customer_id, total_cents, status, payment_method, created_at, paid_at, metadata
    ) VALUES (
      _tenant_id,
      CASE i % 3 WHEN 0 THEN cid_a WHEN 1 THEN cid_b ELSE cid_c END,
      (40000 + i*15000),
      'paid'::order_status,
      'manual',
      now() - ((i*3)::text || ' days')::interval,
      now() - ((i*3)::text || ' days')::interval + interval '5 minutes',
      '{"demo":"true"}'::jsonb
    ) RETURNING id INTO oid;

    INSERT INTO public.order_items (order_id, product_id, quantity, price_cents)
    VALUES
      (oid, CASE i % 3 WHEN 0 THEN pid_a WHEN 1 THEN pid_b ELSE pid_c END, 1+(i%2),
        CASE i % 3 WHEN 0 THEN 49900 WHEN 1 THEN 18900 ELSE 12500 END),
      (oid, CASE i % 2 WHEN 0 THEN pid_d ELSE pid_e END, 1,
        CASE i % 2 WHEN 0 THEN 8900 ELSE 22500 END);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'products', 6, 'customers', 3, 'orders', 5
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_demo_data(_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_owner boolean;
  is_admin boolean;
  del_orders int := 0; del_prod int := 0; del_cust int := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant_id AND owner_user_id=uid)
    INTO is_owner;
  SELECT public.has_role(uid, 'super_admin'::app_role) INTO is_admin;
  IF NOT (is_owner OR is_admin) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH d AS (
    DELETE FROM public.orders
    WHERE tenant_id=_tenant_id AND (metadata->>'demo')='true'
    RETURNING 1
  ) SELECT count(*) INTO del_orders FROM d;
  WITH d AS (
    DELETE FROM public.products
    WHERE tenant_id=_tenant_id AND (metadata->>'demo')='true'
    RETURNING 1
  ) SELECT count(*) INTO del_prod FROM d;
  WITH d AS (
    DELETE FROM public.customers
    WHERE tenant_id=_tenant_id AND (metadata->>'demo')='true'
    RETURNING 1
  ) SELECT count(*) INTO del_cust FROM d;

  RETURN jsonb_build_object('orders', del_orders, 'products', del_prod, 'customers', del_cust);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seed_demo_catalog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_demo_data(uuid) TO authenticated;
