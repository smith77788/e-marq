
-- Wipe previous synthetic orders to start clean
DELETE FROM public.order_items
 WHERE order_id IN (SELECT id FROM public.orders
                     WHERE tenant_id='abec86dc-dfa9-4cde-adc3-c813b7ec455f'
                       AND metadata->>'source' IN ('pilot_simulator','pilot_simulator_lift'));
DELETE FROM public.orders
 WHERE tenant_id='abec86dc-dfa9-4cde-adc3-c813b7ec455f'
   AND metadata->>'source' IN ('pilot_simulator','pilot_simulator_lift');

CREATE OR REPLACE FUNCTION public.simulate_lift_for_recent_decisions(_tenant_id uuid)
RETURNS TABLE(decisions_lifted int, orders_created int, revenue_cents bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
  v_decisions int := 0;
  v_orders int := 0;
  v_revenue bigint := 0;
  v_lift_email text;
  v_lift_product uuid;
  v_n_lift int;
  i int;
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
  v_window_seconds bigint;
BEGIN
  FOR d IN
    SELECT dq.id, dq.executed_at, dq.action_type, dq.payload
      FROM public.decision_queue dq
     WHERE dq.tenant_id = _tenant_id
       AND dq.status = 'done'
       AND dq.executed_at IS NOT NULL
       AND dq.executed_at > now() - interval '24 hours'
       AND dq.executed_at < now() - interval '5 minutes'
  LOOP
    v_decisions := v_decisions + 1;
    v_lift_email := d.payload->>'email';
    v_lift_product := NULLIF(d.payload->>'product_id','')::uuid;
    v_n_lift := 2 + floor(random()*3)::int; -- 2..4 lift orders per decision
    v_window_seconds := GREATEST(EXTRACT(EPOCH FROM (now() - d.executed_at))::bigint, 60);

    FOR i IN 1..v_n_lift LOOP
      -- Spread orders evenly across the post-decision window
      v_created_at := d.executed_at
                     + ((v_window_seconds * (i::numeric/(v_n_lift+1)))::int || ' seconds')::interval;
      v_cust_id := NULL; v_cust_email := NULL; v_cust_name := NULL;

      -- Prefer the lifted email if specified
      IF v_lift_email IS NOT NULL THEN
        SELECT customer_user_id, customer_email, customer_name
          INTO v_cust_id, v_cust_email, v_cust_name
          FROM public.orders
         WHERE tenant_id = _tenant_id AND customer_email = v_lift_email
         LIMIT 1;
      END IF;

      IF v_cust_email IS NULL THEN
        SELECT customer_user_id, customer_email, customer_name
          INTO v_cust_id, v_cust_email, v_cust_name
          FROM public.orders
         WHERE tenant_id = _tenant_id AND customer_email IS NOT NULL
         ORDER BY random() LIMIT 1;
      END IF;

      IF v_cust_email IS NULL THEN CONTINUE; END IF;

      v_order_id := gen_random_uuid();
      v_total := 0;

      INSERT INTO public.orders(id, tenant_id, customer_user_id, customer_email, customer_name,
                                status, total_cents, currency, paid_at, created_at, updated_at,
                                payment_method, metadata)
      VALUES (v_order_id, _tenant_id, v_cust_id, v_cust_email, v_cust_name,
              'paid'::order_status, 0, 'UAH', v_created_at, v_created_at, v_created_at,
              'manual',
              jsonb_build_object('source','pilot_simulator_lift','decision_id', d.id,
                                 'action_type', d.action_type, 'synthetic', true));

      -- 1-3 items, prefer lifted product
      FOR i IN 1..(1 + floor(random()*3)::int) LOOP
        v_prod_id := NULL;
        IF v_lift_product IS NOT NULL THEN
          SELECT id, name, COALESCE(price_cents, 5000)
            INTO v_prod_id, v_prod_name, v_prod_price
            FROM public.products
           WHERE id = v_lift_product AND tenant_id = _tenant_id
             AND COALESCE(price_cents,0) > 0;
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
      END LOOP;

      UPDATE public.orders SET total_cents = v_total WHERE id = v_order_id;
      v_revenue := v_revenue + v_total;
      v_orders := v_orders + 1;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_decisions, v_orders, v_revenue;
END;
$$;

-- Restore some baseline orders (last 14 days, no lift logic — just historical filler)
SELECT public.simulate_pilot_orders('abec86dc-dfa9-4cde-adc3-c813b7ec455f'::uuid, 14);

-- Generate lift orders specifically AFTER each recent decision
SELECT public.simulate_lift_for_recent_decisions('abec86dc-dfa9-4cde-adc3-c813b7ec455f'::uuid);

-- Lower the actual_hours threshold so short windows still measure
CREATE OR REPLACE FUNCTION public.demo_measure_recent_outcomes()
RETURNS TABLE(measured_count integer, success_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_measured int := 0; v_succ int := 0;
  d RECORD;
  v_baseline_revenue bigint; v_baseline_orders int;
  v_actual_revenue bigint;   v_actual_orders int;
  v_delta_revenue bigint;    v_delta_orders int;
  v_is_success bool;
  v_actual_end timestamptz;
  v_actual_hours numeric;
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.agent_id, dq.action_type,
           dq.executor_action_id, dq.executed_at,
           ao.id AS existing_outcome_id
    FROM decision_queue dq
    LEFT JOIN action_outcomes ao ON ao.decision_id = dq.id
    WHERE dq.status = 'done' AND dq.executed_at IS NOT NULL
      AND dq.executed_at > now() - interval '14 days'
      AND (ao.id IS NULL OR ao.success IS NULL OR ao.attributed_revenue_cents = 0)
    LIMIT 200
  LOOP
    v_actual_end := LEAST(d.executed_at + interval '3 days', now());
    v_actual_hours := EXTRACT(EPOCH FROM (v_actual_end - d.executed_at)) / 3600.0;
    IF v_actual_hours < 0.05 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(total_cents),0)::bigint, COUNT(*)::int
      INTO v_baseline_revenue, v_baseline_orders
    FROM orders WHERE tenant_id = d.tenant_id AND status IN ('paid','fulfilled')
      AND created_at >= d.executed_at - interval '3 days' AND created_at < d.executed_at;

    SELECT COALESCE(SUM(total_cents),0)::bigint, COUNT(*)::int
      INTO v_actual_revenue, v_actual_orders
    FROM orders WHERE tenant_id = d.tenant_id AND status IN ('paid','fulfilled')
      AND created_at >= d.executed_at AND created_at < v_actual_end;

    -- Normalize baseline to actual window length
    v_baseline_revenue := (v_baseline_revenue * v_actual_hours / 72.0)::bigint;
    v_baseline_orders  := (v_baseline_orders  * v_actual_hours / 72.0)::int;

    v_delta_revenue := v_actual_revenue - v_baseline_revenue;
    v_delta_orders  := v_actual_orders  - v_baseline_orders;
    v_is_success := v_delta_revenue > 0;

    IF d.existing_outcome_id IS NOT NULL THEN
      UPDATE action_outcomes SET
        baseline = jsonb_build_object('revenue_cents', v_baseline_revenue, 'orders_count', v_baseline_orders, 'window_hours', 72.0),
        actual   = jsonb_build_object('revenue_cents', v_actual_revenue,   'orders_count', v_actual_orders,   'window_hours', v_actual_hours),
        delta    = jsonb_build_object('revenue_cents', v_delta_revenue,    'orders_count', v_delta_orders),
        attributed_revenue_cents = GREATEST(v_delta_revenue, 0),
        success = v_is_success,
        measurement_window = 'demo_pre3d_vs_postNd_normalized',
        measured_at = now(),
        notes = 'demo-remeasured by demo_measure_recent_outcomes() v3'
      WHERE id = d.existing_outcome_id;
    ELSE
      INSERT INTO action_outcomes(tenant_id, decision_id, action_id, agent_id, action_type,
        baseline, actual, delta, attributed_revenue_cents, success,
        measurement_window, measured_at, notes)
      VALUES (d.tenant_id, d.id, d.executor_action_id, d.agent_id, d.action_type,
        jsonb_build_object('revenue_cents', v_baseline_revenue, 'orders_count', v_baseline_orders, 'window_hours', 72.0),
        jsonb_build_object('revenue_cents', v_actual_revenue,   'orders_count', v_actual_orders,   'window_hours', v_actual_hours),
        jsonb_build_object('revenue_cents', v_delta_revenue,    'orders_count', v_delta_orders),
        GREATEST(v_delta_revenue,0), v_is_success,
        'demo_pre3d_vs_postNd_normalized', now(),
        'demo-measured by demo_measure_recent_outcomes() v3');
    END IF;

    v_measured := v_measured + 1;
    IF v_is_success THEN v_succ := v_succ + 1; END IF;
  END LOOP;

  measured_count := v_measured; success_count := v_succ;
  RETURN NEXT;
END;
$$;

SELECT public.demo_measure_recent_outcomes();
