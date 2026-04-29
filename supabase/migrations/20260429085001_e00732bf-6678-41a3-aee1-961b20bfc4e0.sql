
-- Phase 15: Forecast Calibration Loop (fixed: tenant_memberships)

CREATE TABLE IF NOT EXISTS public.forecast_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  action_type text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  sample_size int NOT NULL,
  avg_forecast_cents bigint NOT NULL,
  avg_actual_cents bigint NOT NULL,
  bias_cents bigint NOT NULL,
  mape_pct numeric,
  hit_rate numeric NOT NULL,
  median_ratio numeric
);

CREATE INDEX IF NOT EXISTS idx_forecast_calibration_lookup
  ON public.forecast_calibration (action_type, tenant_id, computed_at DESC);

ALTER TABLE public.forecast_calibration ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calibration_tenant_select" ON public.forecast_calibration;
CREATE POLICY "calibration_tenant_select" ON public.forecast_calibration
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = forecast_calibration.tenant_id
        AND tm.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE OR REPLACE FUNCTION public.compute_forecast_calibration()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
               THEN ABS(actual_cents - forecast_cents)::numeric / forecast_cents * 100 END) AS mape,
      AVG(CASE WHEN forecast_cents > 0 AND actual_cents > 0 THEN 1.0
               WHEN forecast_cents > 0 THEN 0.0 END) AS hit,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY CASE WHEN forecast_cents > 0
                      THEN actual_cents::numeric / forecast_cents END) AS med_ratio
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
                   THEN ABS(actual_cents - forecast_cents)::numeric / forecast_cents * 100 END), 2),
    COALESCE(ROUND(AVG(CASE WHEN forecast_cents > 0 AND actual_cents > 0 THEN 1.0
                            WHEN forecast_cents > 0 THEN 0.0 END), 3), 0),
    ROUND(percentile_cont(0.5) WITHIN GROUP (
      ORDER BY CASE WHEN forecast_cents > 0
                    THEN actual_cents::numeric / forecast_cents END), 3)
  FROM paired
  GROUP BY action_type
  HAVING COUNT(*) >= 1;

  DELETE FROM forecast_calibration WHERE computed_at < now() - interval '90d';
  RETURN jsonb_build_object('ok', true, 'rows_inserted', v_inserted, 'computed_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.get_forecast_calibration(_tenant_id uuid)
RETURNS TABLE (
  action_type text, sample_size int,
  avg_forecast_cents bigint, avg_actual_cents bigint,
  bias_cents bigint, mape_pct numeric, hit_rate numeric,
  median_ratio numeric, scope text, computed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (SELECT 1 FROM tenant_memberships tm
               WHERE tm.tenant_id = _tenant_id AND tm.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT fc.action_type, fc.sample_size, fc.avg_forecast_cents, fc.avg_actual_cents,
           fc.bias_cents, fc.mape_pct, fc.hit_rate, fc.median_ratio,
           CASE WHEN fc.tenant_id IS NULL THEN 'global' ELSE 'tenant' END AS scope,
           fc.computed_at,
           ROW_NUMBER() OVER (PARTITION BY fc.action_type, (fc.tenant_id IS NULL)
                              ORDER BY fc.computed_at DESC) AS rn
    FROM forecast_calibration fc
    WHERE fc.tenant_id = _tenant_id OR fc.tenant_id IS NULL
  ),
  preferred AS (
    SELECT DISTINCT ON (action_type) *
    FROM ranked WHERE rn = 1
    ORDER BY action_type, scope DESC
  )
  SELECT p.action_type, p.sample_size, p.avg_forecast_cents, p.avg_actual_cents,
         p.bias_cents, p.mape_pct, p.hit_rate, p.median_ratio, p.scope, p.computed_at
  FROM preferred p
  ORDER BY p.sample_size DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_forecast_calibration() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_forecast_calibration(uuid) TO authenticated;

SELECT cron.schedule(
  'compute-forecast-calibration-daily',
  '30 4 * * *',
  $cron$ SELECT public.compute_forecast_calibration(); $cron$
);
