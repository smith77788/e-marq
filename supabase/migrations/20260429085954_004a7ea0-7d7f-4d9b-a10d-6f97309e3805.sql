
-- Phase 18: Owner ROI Dashboard SQL backbone
-- Aggregates: cumulative attributed revenue, time saved, win-rate, top wins per action_type

CREATE OR REPLACE FUNCTION public.get_owner_roi_summary(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_total_actions int;
  v_total_revenue_cents bigint;
  v_total_time_saved_minutes int;
  v_win_rate numeric;
  v_avg_lift_pct numeric;
  v_top_action jsonb;
  v_by_action jsonb;
  v_trend jsonb;
BEGIN
  -- Total executed actions all-time
  SELECT COUNT(*) INTO v_total_actions
  FROM decision_queue
  WHERE tenant_id = _tenant_id AND status = 'done';

  -- Time saved: 8 minutes per autonomous action
  v_total_time_saved_minutes := COALESCE(v_total_actions, 0) * 8;

  -- Total attributed revenue from measured outcomes
  SELECT COALESCE(SUM(attributed_revenue_cents), 0) INTO v_total_revenue_cents
  FROM action_outcomes ao
  JOIN decision_queue d ON d.id = ao.decision_id
  WHERE d.tenant_id = _tenant_id
    AND ao.measured_at IS NOT NULL
    AND ao.attributed_revenue_cents IS NOT NULL;

  -- Win rate (positive lift)
  SELECT 
    CASE WHEN COUNT(*) > 0 
         THEN ROUND(100.0 * COUNT(*) FILTER (WHERE ao.attributed_revenue_cents > 0) / COUNT(*), 1)
         ELSE NULL END,
    ROUND(AVG(ao.lift_pct)::numeric, 2)
  INTO v_win_rate, v_avg_lift_pct
  FROM action_outcomes ao
  JOIN decision_queue d ON d.id = ao.decision_id
  WHERE d.tenant_id = _tenant_id
    AND ao.measured_at IS NOT NULL;

  -- Top winning action type
  SELECT jsonb_build_object(
    'action_type', d.action_type,
    'total_revenue_cents', SUM(ao.attributed_revenue_cents),
    'count', COUNT(*)
  ) INTO v_top_action
  FROM action_outcomes ao
  JOIN decision_queue d ON d.id = ao.decision_id
  WHERE d.tenant_id = _tenant_id
    AND ao.measured_at IS NOT NULL
    AND ao.attributed_revenue_cents > 0
  GROUP BY d.action_type
  ORDER BY SUM(ao.attributed_revenue_cents) DESC
  LIMIT 1;

  -- Breakdown by action_type
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_by_action
  FROM (
    SELECT 
      d.action_type,
      COUNT(*) AS executed_count,
      COUNT(ao.id) FILTER (WHERE ao.measured_at IS NOT NULL) AS measured_count,
      COALESCE(SUM(ao.attributed_revenue_cents), 0) AS revenue_cents,
      ROUND(AVG(ao.lift_pct)::numeric, 2) AS avg_lift_pct
    FROM decision_queue d
    LEFT JOIN action_outcomes ao ON ao.decision_id = d.id
    WHERE d.tenant_id = _tenant_id AND d.status = 'done'
    GROUP BY d.action_type
    ORDER BY COALESCE(SUM(ao.attributed_revenue_cents), 0) DESC
    LIMIT 20
  ) t;

  -- 14-day trend
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY (row_to_json(t)->>'day')::date), '[]'::jsonb) INTO v_trend
  FROM (
    SELECT 
      to_char(date_trunc('day', d.executed_at), 'YYYY-MM-DD') AS day,
      COUNT(*) AS actions,
      COALESCE(SUM(ao.attributed_revenue_cents), 0) AS revenue_cents
    FROM decision_queue d
    LEFT JOIN action_outcomes ao ON ao.decision_id = d.id AND ao.measured_at IS NOT NULL
    WHERE d.tenant_id = _tenant_id 
      AND d.status = 'done'
      AND d.executed_at > now() - interval '14 days'
    GROUP BY 1
    ORDER BY 1
  ) t;

  v_result := jsonb_build_object(
    'total_actions', v_total_actions,
    'total_revenue_cents', v_total_revenue_cents,
    'time_saved_minutes', v_total_time_saved_minutes,
    'time_saved_hours', ROUND(v_total_time_saved_minutes / 60.0, 1),
    'win_rate_pct', v_win_rate,
    'avg_lift_pct', v_avg_lift_pct,
    'top_action', v_top_action,
    'by_action', v_by_action,
    'trend_14d', v_trend,
    'computed_at', now()
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_owner_roi_summary(uuid) TO authenticated, anon, service_role;
