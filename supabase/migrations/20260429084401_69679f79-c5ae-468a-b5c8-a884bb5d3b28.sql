
CREATE OR REPLACE FUNCTION public._measurement_explain(
  _baseline_rev bigint,
  _actual_rev bigint,
  _delta_rev bigint,
  _baseline_orders int,
  _actual_orders int,
  _share_denom int,
  _attrib bigint
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_pct numeric;
  v_parts text[] := ARRAY[]::text[];
  v_total_orders int := _baseline_orders + _actual_orders;
BEGIN
  -- Direction + magnitude
  IF _baseline_rev = 0 AND _actual_rev > 0 THEN
    v_parts := array_append(v_parts,
      'Вперше виручка після дії: ' || (_actual_rev / 100)::text || ' ₴ за вікно');
  ELSIF _baseline_rev = 0 AND _actual_rev = 0 THEN
    v_parts := array_append(v_parts, 'Замовлень не було ні до, ні після дії');
  ELSE
    v_pct := ROUND(100.0 * _delta_rev / _baseline_rev, 1);
    IF v_pct >= 25 THEN
      v_parts := array_append(v_parts, 'Сильне зростання виручки після дії (+' || v_pct::text || '%)');
    ELSIF v_pct >= 5 THEN
      v_parts := array_append(v_parts, 'Помірне зростання виручки (+' || v_pct::text || '%)');
    ELSIF v_pct > -5 THEN
      v_parts := array_append(v_parts, 'Без явної зміни виручки (' || v_pct::text || '%)');
    ELSIF v_pct >= -25 THEN
      v_parts := array_append(v_parts, 'Виручка впала (' || v_pct::text || '%) — можливий сезонний фактор');
    ELSE
      v_parts := array_append(v_parts, 'Сильний спад виручки (' || v_pct::text || '%)');
    END IF;
  END IF;

  -- Sample size warning
  IF v_total_orders < 5 THEN
    v_parts := array_append(v_parts, 'мало замовлень — низька статистична надійність');
  END IF;

  -- Attribution noise
  IF _share_denom >= 10 THEN
    v_parts := array_append(v_parts, 'шум від ' || (_share_denom - 1)::text || ' інших дій ускладнив атрибуцію');
  ELSIF _share_denom >= 4 THEN
    v_parts := array_append(v_parts, 'паралельно виконано ' || (_share_denom - 1)::text || ' інших дій');
  END IF;

  -- Attributed revenue
  IF _attrib > 0 THEN
    v_parts := array_append(v_parts, 'атрибуція: ' || (_attrib / 100)::text || ' ₴ цьому рішенню');
  END IF;

  RETURN array_to_string(v_parts, '. ');
END;
$$;

CREATE OR REPLACE FUNCTION public.measure_pending_outcomes()
RETURNS TABLE(measured_count integer, success_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_share_denom int;
  v_attrib bigint;
  v_is_success bool;
  v_post_window interval;
  v_pre_window  interval;
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.agent_id, dq.action_type,
           dq.executor_action_id, dq.executed_at
    FROM decision_queue dq
    LEFT JOIN action_outcomes ao ON ao.decision_id = dq.id
    WHERE dq.status = 'done'
      AND dq.executed_at IS NOT NULL
      AND dq.executed_at <= now() - interval '24 hours'
      AND dq.executed_at >  now() - interval '30 days'
      AND ao.id IS NULL
    LIMIT 500
  LOOP
    v_post_window := LEAST(interval '7 days', now() - d.executed_at);
    v_pre_window  := v_post_window;

    SELECT COALESCE(SUM(total_cents), 0)::bigint, COUNT(*)::int
      INTO v_baseline_revenue, v_baseline_orders
    FROM orders
    WHERE tenant_id = d.tenant_id
      AND status IN ('paid', 'fulfilled')
      AND created_at >= d.executed_at - v_pre_window
      AND created_at <  d.executed_at;

    SELECT COALESCE(SUM(total_cents), 0)::bigint, COUNT(*)::int
      INTO v_actual_revenue, v_actual_orders
    FROM orders
    WHERE tenant_id = d.tenant_id
      AND status IN ('paid', 'fulfilled')
      AND created_at >  d.executed_at
      AND created_at <= d.executed_at + v_post_window;

    v_delta_revenue := v_actual_revenue - v_baseline_revenue;
    v_delta_orders  := v_actual_orders  - v_baseline_orders;

    SELECT GREATEST(COUNT(*), 1)::int INTO v_share_denom
      FROM decision_queue dq2
     WHERE dq2.tenant_id = d.tenant_id
       AND dq2.status = 'done'
       AND dq2.executed_at IS NOT NULL
       AND dq2.executed_at >= d.executed_at - interval '3 days'
       AND dq2.executed_at <= d.executed_at + interval '3 days';

    v_attrib := GREATEST(v_delta_revenue, 0) / v_share_denom;
    v_is_success := v_attrib > 0;

    INSERT INTO action_outcomes (
      tenant_id, decision_id, action_id, agent_id, action_type,
      baseline, actual, delta,
      attributed_revenue_cents, success, measurement_window, measured_at, notes
    ) VALUES (
      d.tenant_id, d.id, d.executor_action_id, d.agent_id, d.action_type,
      jsonb_build_object('revenue_cents', v_baseline_revenue, 'orders_count', v_baseline_orders, 'window_hours', round(EXTRACT(EPOCH FROM v_pre_window)/3600.0, 2)),
      jsonb_build_object('revenue_cents', v_actual_revenue,   'orders_count', v_actual_orders,   'window_hours', round(EXTRACT(EPOCH FROM v_post_window)/3600.0, 2)),
      jsonb_build_object('revenue_cents', v_delta_revenue,    'orders_count', v_delta_orders, 'share_denom', v_share_denom),
      v_attrib, v_is_success,
      'adaptive_pre_vs_post_split', now(),
      public._measurement_explain(v_baseline_revenue, v_actual_revenue, v_delta_revenue,
                                  v_baseline_orders, v_actual_orders, v_share_denom, v_attrib)
    );

    v_measured := v_measured + 1;
    IF v_is_success THEN v_succ := v_succ + 1; END IF;
  END LOOP;

  measured_count := v_measured;
  success_count := v_succ;
  RETURN NEXT;
END;
$function$;
