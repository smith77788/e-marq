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
  cemail text; cname text;
  pid_main uuid; pname_main text; price_main int;
  pid_side uuid; pname_side text; price_side int;
  oid uuid;
  i int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant_id AND owner_user_id=uid) INTO is_owner;
  SELECT public.has_role(uid, 'super_admin'::app_role) INTO is_admin;
  IF NOT (is_owner OR is_admin) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT count(*) INTO prod_count FROM public.products WHERE tenant_id=_tenant_id;
  IF prod_count > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'tenant_has_products');
  END IF;

  INSERT INTO public.products (tenant_id, name, price_cents, stock, is_active, metadata)
  VALUES
    (_tenant_id, 'Демо · Кава Lavazza 1кг', 49900, 24, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Чай Earl Grey 100г', 18900, 40, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Шоколад темний 70%', 12500, 60, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Печиво вівсяне 200г', 8900, 35, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Сироп ванільний', 22500, 12, true, '{"demo":"true"}'::jsonb),
    (_tenant_id, 'Демо · Френч-прес 600мл', 59000, 8, true, '{"demo":"true"}'::jsonb);

  SELECT id INTO pid_a FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Кава Lavazza 1кг' LIMIT 1;
  SELECT id INTO pid_b FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Чай Earl Grey 100г' LIMIT 1;
  SELECT id INTO pid_c FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Шоколад темний 70%' LIMIT 1;
  SELECT id INTO pid_d FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Печиво вівсяне 200г' LIMIT 1;
  SELECT id INTO pid_e FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Сироп ванільний' LIMIT 1;
  SELECT id INTO pid_f FROM public.products WHERE tenant_id=_tenant_id AND name='Демо · Френч-прес 600мл' LIMIT 1;

  INSERT INTO public.customers (tenant_id, email, name, metadata)
  VALUES
    (_tenant_id, 'demo.alice@example.com', 'Аліса (демо)', '{"demo":"true"}'::jsonb),
    (_tenant_id, 'demo.bob@example.com', 'Богдан (демо)', '{"demo":"true"}'::jsonb),
    (_tenant_id, 'demo.carol@example.com', 'Кароліна (демо)', '{"demo":"true"}'::jsonb)
  ON CONFLICT (tenant_id, email) DO NOTHING;
  SELECT id INTO cid_a FROM public.customers WHERE tenant_id=_tenant_id AND email='demo.alice@example.com';
  SELECT id INTO cid_b FROM public.customers WHERE tenant_id=_tenant_id AND email='demo.bob@example.com';
  SELECT id INTO cid_c FROM public.customers WHERE tenant_id=_tenant_id AND email='demo.carol@example.com';

  FOR i IN 0..4 LOOP
    IF i % 3 = 0 THEN cemail := 'demo.alice@example.com'; cname := 'Аліса (демо)';
    ELSIF i % 3 = 1 THEN cemail := 'demo.bob@example.com'; cname := 'Богдан (демо)';
    ELSE cemail := 'demo.carol@example.com'; cname := 'Кароліна (демо)';
    END IF;

    IF i % 3 = 0 THEN pid_main := pid_a; pname_main := 'Демо · Кава Lavazza 1кг'; price_main := 49900;
    ELSIF i % 3 = 1 THEN pid_main := pid_b; pname_main := 'Демо · Чай Earl Grey 100г'; price_main := 18900;
    ELSE pid_main := pid_c; pname_main := 'Демо · Шоколад темний 70%'; price_main := 12500;
    END IF;

    IF i % 2 = 0 THEN pid_side := pid_d; pname_side := 'Демо · Печиво вівсяне 200г'; price_side := 8900;
    ELSE pid_side := pid_e; pname_side := 'Демо · Сироп ванільний'; price_side := 22500;
    END IF;

    INSERT INTO public.orders (
      tenant_id, customer_email, customer_name, total_cents, status, payment_method, created_at, paid_at, metadata
    ) VALUES (
      _tenant_id, cemail, cname,
      (40000 + i*15000),
      'paid'::order_status,
      'manual',
      now() - ((i*3)::text || ' days')::interval,
      now() - ((i*3)::text || ' days')::interval + interval '5 minutes',
      '{"demo":"true"}'::jsonb
    ) RETURNING id INTO oid;

    INSERT INTO public.order_items (tenant_id, order_id, product_id, product_name, quantity, unit_price_cents)
    VALUES
      (_tenant_id, oid, pid_main, pname_main, 1+(i%2), price_main),
      (_tenant_id, oid, pid_side, pname_side, 1, price_side);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'products', 6, 'customers', 3, 'orders', 5);
END;
$function$;