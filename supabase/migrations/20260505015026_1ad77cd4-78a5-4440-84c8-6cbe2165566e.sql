CREATE OR REPLACE FUNCTION public.compute_forecast_calibration()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH paired AS (
    SELECT
      d.tenant_id,
      d.action_type,
      COALESCE((d.payload->'forecast'->>'expected_revenue_cents')::bigint, 0) AS forecast_cents,
      COALESCE(ao.attributed_revenue_cents, 0) AS actual_cents
    FROM action_outcomes ao
    JOIN decision_queue d ON d.id = ao.decision_id
    WHERE ao.measured_at IS NOT NULL
      AND ao.measured_at > now() - interval '30d'
      AND d.payload ? 'forecast'
  ),
  agg AS (
    SELECT
      tenant_id, action_type,
      COUNT(*) AS n,
      AVG(forecast_cents)::bigint AS avg_f,
      AVG(actual_cents)::bigint AS avg_a,
      (AVG(actual_cents) - AVG(forecast_cents))::bigint AS bias,
      AVG(CASE WHEN forecast_cents > 0
               THEN ABS(actual_cents - forecast_cents)::numeric / forecast_cents * 100 END)::numeric AS mape,
      AVG(CASE WHEN forecast_cents > 0 AND actual_cents > 0 THEN 1.0
               WHEN forecast_cents > 0 THEN 0.0 END)::numeric AS hit,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY CASE WHEN forecast_cents > 0
                      THEN actual_cents::numeric / forecast_cents END)::numeric AS med_ratio
    FROM paired
    GROUP BY tenant_id, action_type
  )
  INSERT INTO forecast_calibration
    (tenant_id, action_type, sample_size, avg_forecast_cents, avg_actual_cents,
     bias_cents, mape_pct, hit_rate, median_ratio)
  SELECT tenant_id, action_type, n, avg_f, avg_a, bias,
         ROUND(mape, 2), COALESCE(ROUND(hit, 3), 0), ROUND(med_ratio, 3)
  FROM agg WHERE n >= 1;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  WITH paired AS (
    SELECT
      d.action_type,
      COALESCE((d.payload->'forecast'->>'expected_revenue_cents')::bigint, 0) AS forecast_cents,
      COALESCE(ao.attributed_revenue_cents, 0) AS actual_cents
    FROM action_outcomes ao
    JOIN decision_queue d ON d.id = ao.decision_id
    WHERE ao.measured_at IS NOT NULL
      AND ao.measured_at > now() - interval '30d'
      AND d.payload ? 'forecast'
  )
  INSERT INTO forecast_calibration
    (tenant_id, action_type, sample_size, avg_forecast_cents, avg_actual_cents,
     bias_cents, mape_pct, hit_rate, median_ratio)
  SELECT
    NULL, action_type, COUNT(*),
    AVG(forecast_cents)::bigint, AVG(actual_cents)::bigint,
    (AVG(actual_cents) - AVG(forecast_cents))::bigint,
    ROUND(AVG(CASE WHEN forecast_cents > 0
                   THEN ABS(actual_cents - forecast_cents)::numeric / forecast_cents * 100 END)::numeric, 2),
    COALESCE(ROUND(AVG(CASE WHEN forecast_cents > 0 AND actual_cents > 0 THEN 1.0
                            WHEN forecast_cents > 0 THEN 0.0 END)::numeric, 3), 0),
    ROUND(percentile_cont(0.5) WITHIN GROUP (
      ORDER BY CASE WHEN forecast_cents > 0
                    THEN actual_cents::numeric / forecast_cents END)::numeric, 3)
  FROM paired
  GROUP BY action_type
  HAVING COUNT(*) >= 1;

  DELETE FROM forecast_calibration WHERE computed_at < now() - interval '90d';
  RETURN jsonb_build_object('ok', true, 'rows_inserted', v_inserted, 'computed_at', now());
END;
$function$;