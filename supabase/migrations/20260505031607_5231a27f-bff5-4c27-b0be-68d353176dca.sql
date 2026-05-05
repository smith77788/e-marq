
DROP FUNCTION IF EXISTS public.daily_pilot_simulator();

CREATE OR REPLACE FUNCTION public.simulate_pilot_bundle_orders(
  _tenant_id uuid,
  _orders_per_day int DEFAULT 8,
  _days_back int DEFAULT 1
)
RETURNS TABLE(orders_created int, items_created int, revenue_cents bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d int; i int;
  v_order_id uuid;
  v_cust_email text; v_cust_name text; v_cust_id uuid;
  v_created_at timestamptz;
  v_orders int := 0; v_items int := 0; v_revenue bigint := 0;
  v_pair_count int;
  v_pair_ids uuid[];
  v_a_id uuid; v_b_id uuid;
  v_a_name text; v_b_name text;
  v_a_price int; v_b_price int;
  v_qty_a int; v_qty_b int;
  v_total int;
BEGIN
  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY stock DESC NULLS LAST, created_at) AS rn
    FROM public.products
    WHERE tenant_id = _tenant_id AND is_active = true AND COALESCE(price_cents,0) > 0
    LIMIT 4
  )
  SELECT array_agg(id ORDER BY rn) INTO v_pair_ids FROM ranked;

  IF v_pair_ids IS NULL OR array_length(v_pair_ids,1) < 2 THEN
    RETURN QUERY SELECT 0, 0, 0::bigint; RETURN;
  END IF;
  v_pair_count := array_length(v_pair_ids,1);

  FOR d IN 0.._days_back-1 LOOP
    FOR i IN 1.._orders_per_day LOOP
      CASE (i % 4)
        WHEN 0 THEN v_a_id := v_pair_ids[1]; v_b_id := v_pair_ids[2];
        WHEN 1 THEN v_a_id := v_pair_ids[1]; v_b_id := v_pair_ids[LEAST(3,v_pair_count)];
        WHEN 2 THEN v_a_id := v_pair_ids[LEAST(3,v_pair_count)]; v_b_id := v_pair_ids[LEAST(4,v_pair_count)];
        ELSE       v_a_id := v_pair_ids[2]; v_b_id := v_pair_ids[LEAST(4,v_pair_count)];
      END CASE;
      IF v_a_id = v_b_id THEN CONTINUE; END IF;

      SELECT name, COALESCE(price_cents,5000) INTO v_a_name, v_a_price FROM public.products WHERE id = v_a_id;
      SELECT name, COALESCE(price_cents,5000) INTO v_b_name, v_b_price FROM public.products WHERE id = v_b_id;

      v_created_at := (now() - ((_days_back - 1 - d) || ' days')::interval) - (random()*interval '20 hours');

      SELECT customer_user_id, customer_email, customer_name
        INTO v_cust_id, v_cust_email, v_cust_name
        FROM public.orders
       WHERE tenant_id = _tenant_id AND customer_email IS NOT NULL
       ORDER BY random() LIMIT 1;
      IF v_cust_email IS NULL THEN CONTINUE; END IF;

      v_qty_a := 1 + floor(random()*2)::int;
      v_qty_b := 1 + floor(random()*2)::int;
      v_total := v_qty_a * v_a_price + v_qty_b * v_b_price;
      v_order_id := gen_random_uuid();

      INSERT INTO public.orders(id, tenant_id, customer_user_id, customer_email, customer_name,
                                status, total_cents, currency, paid_at, created_at, updated_at,
                                payment_method, metadata)
      VALUES (v_order_id, _tenant_id, v_cust_id, v_cust_email, v_cust_name,
              'paid'::order_status, v_total, 'UAH', v_created_at, v_created_at, v_created_at,
              'manual', jsonb_build_object('source','pilot_bundle_seeder','synthetic',true,
                                           'bundle_pair', jsonb_build_array(v_a_id, v_b_id)));

      INSERT INTO public.order_items(order_id, tenant_id, product_id, product_name, quantity, unit_price_cents, created_at)
      VALUES (v_order_id, _tenant_id, v_a_id, v_a_name, v_qty_a, v_a_price, v_created_at),
             (v_order_id, _tenant_id, v_b_id, v_b_name, v_qty_b, v_b_price, v_created_at);

      v_orders := v_orders + 1;
      v_items := v_items + 2;
      v_revenue := v_revenue + v_total;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_orders, v_items, v_revenue;
END;
$$;

REVOKE ALL ON FUNCTION public.simulate_pilot_bundle_orders(uuid,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_pilot_bundle_orders(uuid,int,int) TO service_role;

CREATE FUNCTION public.daily_pilot_simulator()
RETURNS TABLE(tenant_id uuid, orders_created int, items_created int, revenue_cents bigint, baseline_revenue_cents bigint, lift_revenue_cents bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _t record; _r record; _b record;
BEGIN
  FOR _t IN SELECT id FROM public.tenants WHERE is_pilot = true AND status IN ('active','pending') LOOP
    SELECT * INTO _r FROM public.simulate_pilot_orders_with_lift(_t.id, 1, 3);
    BEGIN
      SELECT * INTO _b FROM public.simulate_pilot_bundle_orders(_t.id, 8, 1);
    EXCEPTION WHEN OTHERS THEN _b := NULL; END;
    RETURN QUERY SELECT _t.id, _r.orders_created + COALESCE(_b.orders_created,0),
                        _r.items_created + COALESCE(_b.items_created,0),
                        _r.revenue_cents + COALESCE(_b.revenue_cents,0),
                        _r.baseline_revenue_cents,
                        _r.lift_revenue_cents;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.daily_pilot_simulator() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_pilot_simulator() TO service_role;

DO $$
DECLARE _t record; _b record; _e record; _i record;
BEGIN
  FOR _t IN SELECT id, slug FROM public.tenants WHERE is_pilot = true LOOP
    SELECT * INTO _b FROM public.simulate_pilot_bundle_orders(_t.id, 8, 14);
    RAISE NOTICE 'pilot=% bundle-seed orders=% items=% rev=%', _t.slug, _b.orders_created, _b.items_created, _b.revenue_cents;
  END LOOP;
  SELECT * INTO _e FROM public.compute_bundle_suggestions();
  SELECT * INTO _i FROM public.detect_bundle_signals();
  RAISE NOTICE 'engine: tenants=% ins=% upd=%, insights=%',
    _e.processed_tenants, _e.pairs_inserted, _e.pairs_updated, _i.insights_created;
END $$;
