CREATE OR REPLACE FUNCTION public.demo_measure_recent_outcomes()
 RETURNS TABLE(measured_count integer, success_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_measured int := 0; v_succ int := 0;
  d RECORD;
  v_baseline_revenue bigint; v_baseline_orders int;
  v_actual_revenue bigint;   v_actual_orders int;
  v_delta_revenue bigint;    v_delta_orders int;
  v_actual_end timestamptz;
  v_actual_hours numeric;
  v_share_denom int;
  v_attrib bigint;
  v_is_success bool;
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.agent_id, dq.action_type,
           dq.executor_action_id, dq.executed_at,
           ao.id AS existing_outcome_id
      FROM decision_queue dq
      LEFT JOIN action_outcomes ao ON ao.decision_id = dq.id
     WHERE dq.status = 'done' AND dq.executed_at IS NOT NULL
       AND dq.executed_at > now() - interval '14 days'
       -- ПОЧЕКАТИ мінімум 24 години після виконання, щоб встигли прийти замовлення
       AND dq.executed_at < now() - interval '24 hours'
     LIMIT 500
  LOOP
    v_actual_end := LEAST(d.executed_at + interval '3 days', now());
    v_actual_hours := EXTRACT(EPOCH FROM (v_actual_end - d.executed_at)) / 3600.0;
    IF v_actual_hours < 24.0 THEN CONTINUE; END IF;

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

    SELECT GREATEST(COUNT(*), 1)::int INTO v_share_denom
      FROM decision_queue dq2
     WHERE dq2.tenant_id = d.tenant_id
       AND dq2.status = 'done' AND dq2.executed_at IS NOT NULL
       AND dq2.executed_at >= d.executed_at - interval '3 days'
       AND dq2.executed_at <= d.executed_at + interval '3 days';

    v_attrib := GREATEST(v_delta_revenue, 0) / v_share_denom;
    v_is_success := v_attrib > 0;

    IF d.existing_outcome_id IS NOT NULL THEN
      UPDATE action_outcomes SET
        baseline = jsonb_build_object('revenue_cents', v_baseline_revenue, 'orders_count', v_baseline_orders, 'window_hours', round(v_actual_hours,2)),
        actual   = jsonb_build_object('revenue_cents', v_actual_revenue,   'orders_count', v_actual_orders,   'window_hours', round(v_actual_hours,2)),
        delta    = jsonb_build_object('revenue_cents', v_delta_revenue,    'orders_count', v_delta_orders, 'share_denom', v_share_denom),
        attributed_revenue_cents = v_attrib,
        success = v_is_success,
        measurement_window = 'pre3d_vs_post_normalized',
        measured_at = now(),
        notes = format('1/%s of tenant delta over %sh', v_share_denom, round(v_actual_hours,1))
      WHERE id = d.existing_outcome_id;
    ELSE
      INSERT INTO action_outcomes(tenant_id, decision_id, action_id, agent_id, action_type,
        baseline, actual, delta, attributed_revenue_cents, success,
        measurement_window, measured_at, notes)
      VALUES (d.tenant_id, d.id, d.executor_action_id, d.agent_id, d.action_type,
        jsonb_build_object('revenue_cents', v_baseline_revenue, 'orders_count', v_baseline_orders, 'window_hours', round(v_actual_hours,2)),
        jsonb_build_object('revenue_cents', v_actual_revenue,   'orders_count', v_actual_orders,   'window_hours', round(v_actual_hours,2)),
        jsonb_build_object('revenue_cents', v_delta_revenue,    'orders_count', v_delta_orders, 'share_denom', v_share_denom),
        v_attrib, v_is_success,
        'pre3d_vs_post_normalized', now(),
        format('1/%s of tenant delta over %sh', v_share_denom, round(v_actual_hours,1)));
    END IF;

    v_measured := v_measured + 1;
    IF v_is_success THEN v_succ := v_succ + 1; END IF;
  END LOOP;

  measured_count := v_measured; success_count := v_succ;
  RETURN NEXT;
END;
$function$;

-- Видалити недозрілі outcomes (виміряні занадто рано — actual_hours < 24)
DELETE FROM action_outcomes
WHERE measurement_window='demo_pre3d_vs_postNd_split'
  AND (actual->>'window_hours')::numeric < 24
  AND measured_at > now() - interval '7 days';