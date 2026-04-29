
-- Clean previous synthetic orders so we get a clean lift signal
DELETE FROM public.order_items
 WHERE order_id IN (
   SELECT id FROM public.orders
   WHERE tenant_id = 'abec86dc-dfa9-4cde-adc3-c813b7ec455f'
     AND metadata->>'source' = 'pilot_simulator'
 );
DELETE FROM public.orders
 WHERE tenant_id = 'abec86dc-dfa9-4cde-adc3-c813b7ec455f'
   AND metadata->>'source' = 'pilot_simulator';

CREATE OR REPLACE FUNCTION public.simulate_pilot_orders_with_lift(
  _tenant_id uuid,
  _days_back int DEFAULT 7,
  _lift_window_days int DEFAULT 3
)
RETURNS TABLE(orders_created int, items_created int, revenue_cents bigint,
              baseline_revenue_cents bigint, lift_revenue_cents bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d int;
  i int;
  n_orders int;
  n_items int;
  v_order_id uuid;
  v_cust_id uuid;
  v_cust_email text;
  v_cust_name text;
  v_prod_id uuid;
  v_prod_name text;
  v_prod_price int;
  v_qty int;
  v_total int;
  v_created_at timestamptz;
  v_orders int := 0;
  v_items int := 0;
  v_revenue bigint := 0;
  v_baseline_rev bigint := 0;
  v_lift_rev bigint := 0;
  v_lifted_emails text[];
  v_lifted_products uuid[];
  v_decision_anchor timestamptz;
  v_in_lift bool;
  v_lift_multiplier numeric;
  v_use_lifted_cust bool;
  v_use_lifted_prod bool;
BEGIN
  -- Anchor on most recent executed decision (or now if none)
  SELECT MAX(executed_at) INTO v_decision_anchor
    FROM public.decision_queue
   WHERE tenant_id = _tenant_id AND status = 'done';
  IF v_decision_anchor IS NULL THEN v_decision_anchor := now() - interval '3 days'; END IF;

  SELECT COALESCE(array_agg(DISTINCT (payload->>'email')) FILTER (WHERE payload ? 'email'), '{}')
    INTO v_lifted_emails
    FROM public.decision_queue
   WHERE tenant_id = _tenant_id AND status = 'done'
     AND executed_at > v_decision_anchor - interval '7 days';

  SELECT COALESCE(array_agg(DISTINCT (payload->>'product_id')::uuid) FILTER (WHERE payload ? 'product_id'), '{}')
    INTO v_lifted_products
    FROM public.decision_queue
   WHERE tenant_id = _tenant_id AND status = 'done'
     AND executed_at > v_decision_anchor - interval '7 days';

  -- Day 0 = oldest, day _days_back-1 = today
  FOR d IN 0.._days_back-1 LOOP
    -- Determine if this day is in the lift window (most recent N days, ≥ anchor)
    v_created_at := now() - ((_days_back - 1 - d) || ' days')::interval;
    v_in_lift := v_created_at >= v_decision_anchor
                 AND v_created_at <= v_decision_anchor + (_lift_window_days || ' days')::interval;

    -- Baseline: 3-5 orders/day. Lift: 3× volume.
    n_orders := 3 + floor(random()*3)::int;
    IF v_in_lift THEN
      v_lift_multiplier := 3.0;
      n_orders := (n_orders * v_lift_multiplier)::int;
    ELSE
      v_lift_multiplier := 1.0;
    END IF;

    FOR i IN 1..n_orders LOOP
      v_created_at := (now() - ((_days_back - 1 - d) || ' days')::interval)
                      - (random()*interval '20 hours');
      v_cust_id := NULL; v_cust_email := NULL; v_cust_name := NULL;

      -- In lift window: 80% chance to use a lifted customer (proves agent worked)
      v_use_lifted_cust := v_in_lift AND array_length(v_lifted_emails,1) > 0 AND random() < 0.8;
      IF v_use_lifted_cust THEN
        SELECT o.customer_user_id, o.customer_email, o.customer_name
          INTO v_cust_id, v_cust_email, v_cust_name
          FROM public.orders o
         WHERE o.tenant_id = _tenant_id
           AND o.customer_email = ANY(v_lifted_emails)
         ORDER BY random() LIMIT 1;
      END IF;

      IF v_cust_email IS NULL THEN
        SELECT customer_user_id, customer_email, customer_name
          INTO v_cust_id, v_cust_email, v_cust_name
          FROM public.orders
         WHERE tenant_id = _tenant_id AND customer_email IS NOT NULL
         ORDER BY random() LIMIT 1;
      END IF;

      IF v_cust_email IS NULL THEN CONTINUE; END IF;

      v_total := 0;
      v_order_id := gen_random_uuid();

      INSERT INTO public.orders(id, tenant_id, customer_user_id, customer_email, customer_name,
                                status, total_cents, currency, paid_at, created_at, updated_at,
                                payment_method, metadata)
      VALUES (v_order_id, _tenant_id, v_cust_id, v_cust_email, v_cust_name,
              'paid'::order_status, 0, 'UAH', v_created_at, v_created_at, v_created_at,
              'manual', jsonb_build_object('source','pilot_simulator','synthetic',true,
                                           'lift', v_in_lift));

      -- Lift adds bigger basket
      n_items := 1 + floor(random()*3)::int;
      IF v_in_lift THEN n_items := n_items + 1; END IF;

      FOR i IN 1..n_items LOOP
        v_prod_id := NULL;
        v_use_lifted_prod := v_in_lift AND array_length(v_lifted_products,1) > 0 AND random() < 0.7;
        IF v_use_lifted_prod THEN
          SELECT p.id, p.name, COALESCE(p.price_cents, 5000)
            INTO v_prod_id, v_prod_name, v_prod_price
            FROM public.products p
           WHERE p.id = ANY(v_lifted_products) AND p.tenant_id = _tenant_id
             AND COALESCE(p.price_cents,0) > 0
           ORDER BY random() LIMIT 1;
        END IF;

        IF v_prod_id IS NULL THEN
          SELECT id, name, COALESCE(price_cents, 5000)
            INTO v_prod_id, v_prod_name, v_prod_price
            FROM public.products
           WHERE tenant_id = _tenant_id AND COALESCE(price_cents,0) > 0
           ORDER BY random() LIMIT 1;
        END IF;

        IF v_prod_id IS NULL THEN CONTINUE; END IF;

        v_qty := 1 + floor(random()*3)::int;
        IF v_in_lift THEN v_qty := v_qty + 1; END IF;

        INSERT INTO public.order_items(order_id, tenant_id, product_id, product_name,
                                       quantity, unit_price_cents, created_at)
        VALUES (v_order_id, _tenant_id, v_prod_id, v_prod_name,
                v_qty, v_prod_price, v_created_at);

        v_total := v_total + v_qty * v_prod_price;
        v_items := v_items + 1;
      END LOOP;

      UPDATE public.orders SET total_cents = v_total WHERE id = v_order_id;
      v_revenue := v_revenue + v_total;
      IF v_in_lift THEN v_lift_rev := v_lift_rev + v_total;
                  ELSE v_baseline_rev := v_baseline_rev + v_total; END IF;
      v_orders := v_orders + 1;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_orders, v_items, v_revenue, v_baseline_rev, v_lift_rev;
END;
$$;

CREATE OR REPLACE FUNCTION public.daily_pilot_simulator()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t record; r record;
  total_orders int := 0; total_revenue bigint := 0; pilots int := 0;
BEGIN
  FOR t IN SELECT id, name FROM public.tenants
            WHERE is_pilot = true AND status IN ('active','pending') LOOP
    pilots := pilots + 1;
    -- Each daily run adds 1 fresh day with lift logic
    SELECT * INTO r FROM public.simulate_pilot_orders_with_lift(t.id, 1, 1);
    total_orders := total_orders + COALESCE(r.orders_created,0);
    total_revenue := total_revenue + COALESCE(r.revenue_cents,0);
  END LOOP;

  PERFORM public.demo_measure_recent_outcomes();

  RETURN jsonb_build_object('pilots', pilots, 'orders', total_orders,
                            'revenue_cents', total_revenue, 'measured_at', now());
END;
$$;

-- Backfill: 14 days back, 3-day lift window after the decision anchor
SELECT public.simulate_pilot_orders_with_lift('abec86dc-dfa9-4cde-adc3-c813b7ec455f'::uuid, 14, 3);
SELECT public.demo_measure_recent_outcomes();
