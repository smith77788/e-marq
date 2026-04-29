
CREATE OR REPLACE FUNCTION public.daily_pilot_simulator()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t record;
  r1 record;
  r2 record;
  pilots int := 0;
  total_orders int := 0;
  total_lift int := 0;
  total_revenue bigint := 0;
BEGIN
  FOR t IN SELECT id, name FROM public.tenants
            WHERE is_pilot = true AND status IN ('active','pending') LOOP
    pilots := pilots + 1;

    -- 1) Add 1 new day of baseline volume
    SELECT * INTO r1 FROM public.simulate_pilot_orders(t.id, 1);
    total_orders := total_orders + COALESCE(r1.orders_created,0);
    total_revenue := total_revenue + COALESCE(r1.revenue_cents,0);

    -- 2) Generate lift for any decisions executed in the last 24h
    SELECT * INTO r2 FROM public.simulate_lift_for_recent_decisions(t.id);
    total_lift := total_lift + COALESCE(r2.orders_created,0);
    total_revenue := total_revenue + COALESCE(r2.revenue_cents,0);
  END LOOP;

  PERFORM public.demo_measure_recent_outcomes();

  RETURN jsonb_build_object(
    'pilots', pilots,
    'baseline_orders', total_orders,
    'lift_orders', total_lift,
    'revenue_cents', total_revenue,
    'measured_at', now()
  );
END;
$$;
