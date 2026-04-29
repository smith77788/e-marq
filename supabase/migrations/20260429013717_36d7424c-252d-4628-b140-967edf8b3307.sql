
CREATE OR REPLACE FUNCTION public.demo_measure_recent_outcomes()
RETURNS TABLE(measured_count int, success_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_measured int := 0;
  v_succ int := 0;
  d RECORD;
  v_baseline_revenue bigint;
  v_baseline_orders int;
  v_actual_revenue bigint;
  v_actual_orders int;
  v_delta_revenue bigint;
  v_delta_orders int;
  v_is_success bool;
  v_anchor timestamptz;
  v_outcome_id uuid;
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.agent_id, dq.action_type,
           dq.executor_action_id, dq.executed_at,
           ao.id AS existing_outcome_id, ao.success AS existing_success
    FROM decision_queue dq
    LEFT JOIN action_outcomes ao ON ao.decision_id = dq.id
    WHERE dq.status = 'done'
      AND dq.executed_at IS NOT NULL
      AND (ao.id IS NULL OR ao.success IS NULL)  -- new OR unmeasured placeholder
    LIMIT 200
  LOOP
    SELECT GREATEST(d.executed_at, max(created_at) - interval '3 days')
      INTO v_anchor
    FROM orders WHERE tenant_id = d.tenant_id;
    IF v_anchor IS NULL THEN v_anchor := d.executed_at; END IF;

    SELECT COALESCE(SUM(total_cents), 0)::bigint, COUNT(*)::int
      INTO v_baseline_revenue, v_baseline_orders
    FROM orders
    WHERE tenant_id = d.tenant_id
      AND status IN ('paid', 'fulfilled')
      AND created_at >= v_anchor - interval '3 days'
      AND created_at <  v_anchor;

    SELECT COALESCE(SUM(total_cents), 0)::bigint, COUNT(*)::int
      INTO v_actual_revenue, v_actual_orders
    FROM orders
    WHERE tenant_id = d.tenant_id
      AND status IN ('paid', 'fulfilled')
      AND created_at >= v_anchor
      AND created_at <  v_anchor + interval '3 days';

    v_delta_revenue := v_actual_revenue - v_baseline_revenue;
    v_delta_orders  := v_actual_orders  - v_baseline_orders;
    v_is_success := v_delta_revenue > 0;

    IF d.existing_outcome_id IS NOT NULL THEN
      UPDATE action_outcomes SET
        baseline = jsonb_build_object('revenue_cents', v_baseline_revenue, 'orders_count', v_baseline_orders),
        actual   = jsonb_build_object('revenue_cents', v_actual_revenue,   'orders_count', v_actual_orders),
        delta    = jsonb_build_object('revenue_cents', v_delta_revenue,    'orders_count', v_delta_orders),
        attributed_revenue_cents = GREATEST(v_delta_revenue, 0),
        success = v_is_success,
        measurement_window = 'demo_3d_around_anchor',
        measured_at = now(),
        notes = 'demo-remeasured by demo_measure_recent_outcomes()'
      WHERE id = d.existing_outcome_id;
    ELSE
      INSERT INTO action_outcomes (
        tenant_id, decision_id, action_id, agent_id, action_type,
        baseline, actual, delta,
        attributed_revenue_cents, success, measurement_window, measured_at, notes
      ) VALUES (
        d.tenant_id, d.id, d.executor_action_id, d.agent_id, d.action_type,
        jsonb_build_object('revenue_cents', v_baseline_revenue, 'orders_count', v_baseline_orders),
        jsonb_build_object('revenue_cents', v_actual_revenue,   'orders_count', v_actual_orders),
        jsonb_build_object('revenue_cents', v_delta_revenue,    'orders_count', v_delta_orders),
        GREATEST(v_delta_revenue, 0),
        v_is_success,
        'demo_3d_around_anchor',
        now(),
        'demo-measured by demo_measure_recent_outcomes()'
      );
    END IF;

    v_measured := v_measured + 1;
    IF v_is_success THEN v_succ := v_succ + 1; END IF;
  END LOOP;

  measured_count := v_measured;
  success_count := v_succ;
  RETURN NEXT;
END;
$$;

SELECT * FROM public.demo_measure_recent_outcomes();
