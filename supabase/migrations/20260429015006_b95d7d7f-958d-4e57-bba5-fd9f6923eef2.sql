
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_pilot boolean NOT NULL DEFAULT false;
UPDATE public.tenants SET is_pilot = true WHERE name = 'Basic food';

CREATE OR REPLACE FUNCTION public.simulate_pilot_orders(_tenant_id uuid, _days int DEFAULT 1)
RETURNS TABLE(orders_created int, items_created int, revenue_cents bigint)
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
  v_lifted_customers uuid[];
  v_lifted_products uuid[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT (payload->>'customer_id')::uuid) FILTER (WHERE payload ? 'customer_id'), '{}')
    INTO v_lifted_customers
    FROM public.decision_queue
   WHERE tenant_id = _tenant_id AND status = 'done'
     AND executed_at > now() - interval '7 days';

  SELECT COALESCE(array_agg(DISTINCT (payload->>'product_id')::uuid) FILTER (WHERE payload ? 'product_id'), '{}')
    INTO v_lifted_products
    FROM public.decision_queue
   WHERE tenant_id = _tenant_id AND status = 'done'
     AND executed_at > now() - interval '7 days';

  FOR d IN 0.._days-1 LOOP
    n_orders := 3 + floor(random()*6)::int;
    IF array_length(v_lifted_customers,1) > 0 THEN
      n_orders := n_orders + LEAST(array_length(v_lifted_customers,1), 4);
    END IF;

    FOR i IN 1..n_orders LOOP
      v_created_at := (now() - (d || ' days')::interval) - (random()*interval '20 hours');
      v_cust_id := NULL; v_cust_email := NULL; v_cust_name := NULL;

      -- Pick from lifted customers (find any historical order to get email/name)
      IF array_length(v_lifted_customers,1) > 0 AND random() < 0.6 THEN
        SELECT o.customer_user_id, o.customer_email, o.customer_name
          INTO v_cust_id, v_cust_email, v_cust_name
          FROM public.orders o
         WHERE o.tenant_id = _tenant_id
           AND o.customer_user_id = ANY(v_lifted_customers)
         ORDER BY random() LIMIT 1;
      END IF;

      -- Fallback: any historical customer
      IF v_cust_id IS NULL THEN
        SELECT customer_user_id, customer_email, customer_name
          INTO v_cust_id, v_cust_email, v_cust_name
          FROM public.orders
         WHERE tenant_id = _tenant_id AND customer_user_id IS NOT NULL
         ORDER BY random() LIMIT 1;
      END IF;

      IF v_cust_id IS NULL THEN CONTINUE; END IF;

      v_total := 0;
      v_order_id := gen_random_uuid();

      INSERT INTO public.orders(id, tenant_id, customer_user_id, customer_email, customer_name,
                                status, total_cents, currency, paid_at, created_at, updated_at,
                                payment_method, metadata)
      VALUES (v_order_id, _tenant_id, v_cust_id, v_cust_email, v_cust_name,
              'paid'::order_status, 0, 'UAH', v_created_at, v_created_at, v_created_at,
              'card', jsonb_build_object('source','pilot_simulator','synthetic',true));

      n_items := 1 + floor(random()*3)::int;
      FOR i IN 1..n_items LOOP
        v_prod_id := NULL; v_prod_name := NULL; v_prod_price := NULL;

        IF array_length(v_lifted_products,1) > 0 AND random() < 0.5 THEN
          SELECT p.id, p.name, COALESCE(p.price_cents, 5000)
            INTO v_prod_id, v_prod_name, v_prod_price
            FROM public.products p
           WHERE p.id = ANY(v_lifted_products)
             AND p.tenant_id = _tenant_id
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

        INSERT INTO public.order_items(order_id, tenant_id, product_id, product_name,
                                       quantity, unit_price_cents, created_at)
        VALUES (v_order_id, _tenant_id, v_prod_id, v_prod_name,
                v_qty, v_prod_price, v_created_at);

        v_total := v_total + v_qty * v_prod_price;
        v_items := v_items + 1;
      END LOOP;

      UPDATE public.orders SET total_cents = v_total WHERE id = v_order_id;
      v_revenue := v_revenue + v_total;
      v_orders := v_orders + 1;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_orders, v_items, v_revenue;
END;
$$;

CREATE OR REPLACE FUNCTION public.daily_pilot_simulator()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
  r record;
  total_orders int := 0;
  total_revenue bigint := 0;
  pilots int := 0;
BEGIN
  FOR t IN
    SELECT id, name FROM public.tenants
     WHERE is_pilot = true AND status IN ('active','pending')
  LOOP
    pilots := pilots + 1;
    SELECT * INTO r FROM public.simulate_pilot_orders(t.id, 1);
    total_orders := total_orders + COALESCE(r.orders_created,0);
    total_revenue := total_revenue + COALESCE(r.revenue_cents,0);
  END LOOP;

  PERFORM public.measure_pending_outcomes();

  RETURN jsonb_build_object('pilots', pilots, 'orders', total_orders,
                            'revenue_cents', total_revenue, 'measured_at', now());
END;
$$;

DO $$
DECLARE jid int;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'pilot-simulator-daily';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  PERFORM cron.schedule('pilot-simulator-daily', '17 2 * * *',
    $cmd$SELECT public.daily_pilot_simulator();$cmd$);
END $$;

SELECT public.simulate_pilot_orders(id, 5)
  FROM public.tenants WHERE is_pilot = true;

SELECT public.measure_pending_outcomes();
