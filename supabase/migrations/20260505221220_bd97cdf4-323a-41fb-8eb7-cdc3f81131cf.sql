
-- =========================================================
-- LTV Forecasts table
-- =========================================================
CREATE TABLE IF NOT EXISTS public.ltv_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cohort_month date NOT NULL,
  m30_avg_revenue_cents bigint NOT NULL DEFAULT 0,
  predicted_ltv_12m_cents bigint NOT NULL DEFAULT 0,
  multiplier numeric NOT NULL DEFAULT 1,
  multiplier_source text NOT NULL DEFAULT 'bootstrap',  -- tenant|global|bootstrap
  confidence text NOT NULL DEFAULT 'low',               -- high|medium|low
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cohort_month)
);

CREATE INDEX IF NOT EXISTS idx_ltv_forecasts_tenant ON public.ltv_forecasts(tenant_id, cohort_month DESC);

ALTER TABLE public.ltv_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read ltv_forecasts"
ON public.ltv_forecasts FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id = ltv_forecasts.tenant_id AND m.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'super_admin')
);

-- =========================================================
-- compute_ltv_forecasts() — daily 03:45 UTC
-- =========================================================
CREATE OR REPLACE FUNCTION public.compute_ltv_forecasts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed int := 0;
  v_global_mult numeric;
  r record;
  v_tenant_mult numeric;
  v_tenant_n int;
  v_mult numeric;
  v_source text;
  v_confidence text;
  v_m30 bigint;
  v_arr jsonb;
  v_len int;
  v_sum_12m numeric;
  v_predicted bigint;
BEGIN
  -- Compute global multiplier from all mature cohorts (≥12 month buckets, m0 > 0)
  SELECT median(mult) INTO v_global_mult
  FROM (
    SELECT (
      (SELECT SUM((e.value)::numeric)
         FROM jsonb_array_elements(revenue_curve) WITH ORDINALITY e(value, ord)
         WHERE ord <= 12)
      / NULLIF(((revenue_curve->>0)::numeric), 0)
    ) AS mult
    FROM public.customer_cohorts
    WHERE jsonb_array_length(revenue_curve) >= 12
      AND COALESCE((revenue_curve->>0)::numeric, 0) > 0
      AND cohort_month <= (date_trunc('month', now()) - interval '12 months')::date
  ) s
  WHERE mult IS NOT NULL AND mult > 0;

  IF v_global_mult IS NULL OR v_global_mult <= 0 THEN
    v_global_mult := 4.0; -- bootstrap default
  END IF;

  FOR r IN
    SELECT cc.tenant_id, cc.cohort_month, cc.revenue_curve
    FROM public.customer_cohorts cc
    WHERE cc.revenue_curve IS NOT NULL
      AND jsonb_array_length(cc.revenue_curve) > 0
  LOOP
    v_arr := r.revenue_curve;
    v_len := jsonb_array_length(v_arr);
    v_m30 := COALESCE((v_arr->>0)::bigint, 0);

    IF v_m30 <= 0 THEN
      CONTINUE;
    END IF;

    -- Tenant-specific multiplier (only mature cohorts ≥ 12 months old)
    SELECT
      median(mult),
      COUNT(*)
    INTO v_tenant_mult, v_tenant_n
    FROM (
      SELECT (
        (SELECT SUM((e.value)::numeric)
           FROM jsonb_array_elements(revenue_curve) WITH ORDINALITY e(value, ord)
           WHERE ord <= 12)
        / NULLIF(((revenue_curve->>0)::numeric), 0)
      ) AS mult
      FROM public.customer_cohorts
      WHERE tenant_id = r.tenant_id
        AND jsonb_array_length(revenue_curve) >= 12
        AND COALESCE((revenue_curve->>0)::numeric, 0) > 0
        AND cohort_month <= (date_trunc('month', now()) - interval '12 months')::date
    ) s
    WHERE mult IS NOT NULL AND mult > 0;

    IF COALESCE(v_tenant_n, 0) >= 6 THEN
      v_mult := v_tenant_mult; v_source := 'tenant'; v_confidence := 'high';
    ELSIF COALESCE(v_tenant_n, 0) >= 3 THEN
      v_mult := v_tenant_mult; v_source := 'tenant'; v_confidence := 'medium';
    ELSE
      v_mult := v_global_mult; v_source := 'global'; v_confidence := 'low';
    END IF;

    -- If cohort already has enough months, prefer actual sum over multiplier
    IF v_len >= 12 THEN
      SELECT SUM((e.value)::numeric)
      INTO v_sum_12m
      FROM jsonb_array_elements(v_arr) WITH ORDINALITY e(value, ord)
      WHERE ord <= 12;
      v_predicted := COALESCE(v_sum_12m, v_m30 * v_mult)::bigint;
      v_confidence := 'high';
      v_source := 'actual';
    ELSE
      v_predicted := (v_m30 * v_mult)::bigint;
    END IF;

    INSERT INTO public.ltv_forecasts
      (tenant_id, cohort_month, m30_avg_revenue_cents, predicted_ltv_12m_cents,
       multiplier, multiplier_source, confidence, computed_at)
    VALUES
      (r.tenant_id, r.cohort_month, v_m30, v_predicted, v_mult, v_source, v_confidence, now())
    ON CONFLICT (tenant_id, cohort_month)
    DO UPDATE SET
      m30_avg_revenue_cents = EXCLUDED.m30_avg_revenue_cents,
      predicted_ltv_12m_cents = EXCLUDED.predicted_ltv_12m_cents,
      multiplier = EXCLUDED.multiplier,
      multiplier_source = EXCLUDED.multiplier_source,
      confidence = EXCLUDED.confidence,
      computed_at = now();

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'global_multiplier', v_global_mult,
    'ran_at', now()
  );
END;
$$;

-- =========================================================
-- detect_ltv_signals() — daily 04:00 UTC
-- =========================================================
CREATE OR REPLACE FUNCTION public.detect_ltv_signals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emitted int := 0;
  r record;
  v_avg_cac numeric;
  v_floor numeric;
  v_baseline_median numeric;
  v_dedup_key bigint;
  v_exists int;
BEGIN
  -- Process latest cohort per tenant where confidence != 'low' OR enough data
  FOR r IN
    SELECT DISTINCT ON (lf.tenant_id)
      lf.tenant_id, lf.cohort_month, lf.predicted_ltv_12m_cents, lf.confidence, lf.m30_avg_revenue_cents
    FROM public.ltv_forecasts lf
    JOIN public.tenants t ON t.id = lf.tenant_id
    WHERE COALESCE(t.is_pilot, false) = false
      AND lf.cohort_month >= (date_trunc('month', now()) - interval '3 months')::date
    ORDER BY lf.tenant_id, lf.cohort_month DESC
  LOOP
    -- LTV vs CAC: avg CAC across recent 3 months
    SELECT AVG(
      CASE WHEN ac.new_customers > 0
        THEN ac.spend_cents::numeric / ac.new_customers
        ELSE NULL END
    )
    INTO v_avg_cac
    FROM public.acquisition_costs ac
    WHERE ac.tenant_id = r.tenant_id
      AND ac.period_month >= (date_trunc('month', now()) - interval '3 months')::date;

    IF v_avg_cac IS NOT NULL AND v_avg_cac > 0 THEN
      v_floor := v_avg_cac * 1.2;
      IF r.predicted_ltv_12m_cents < v_floor THEN
        v_dedup_key := ('x' || substr(md5(format('ltv_below_cac:%s:%s', r.tenant_id::text, r.cohort_month::text)), 1, 16))::bit(64)::bigint;
        SELECT COUNT(*) INTO v_exists
        FROM public.ai_insights
        WHERE tenant_id = r.tenant_id
          AND insight_type = 'ltv_below_cac_floor'
          AND dedup_bucket = v_dedup_key
          AND created_at > now() - interval '14 days';

        IF v_exists = 0 THEN
          INSERT INTO public.ai_insights
            (tenant_id, insight_type, severity, title, body, metrics, status, agent_id, dedup_bucket)
          VALUES (
            r.tenant_id, 'ltv_below_cac_floor', 'high',
            format('LTV когорти %s нижчий за CAC × 1.2', to_char(r.cohort_month, 'YYYY-MM')),
            format('Прогноз 12m LTV = %s ₴/клієнт, CAC = %s ₴. Канал/реклама не окупається.',
                   round(r.predicted_ltv_12m_cents / 100.0),
                   round(v_avg_cac / 100.0)),
            jsonb_build_object(
              'cohort_month', r.cohort_month,
              'predicted_ltv_12m_cents', r.predicted_ltv_12m_cents,
              'avg_cac_cents', round(v_avg_cac),
              'confidence', r.confidence,
              'action', 'owner_review'
            ),
            'open', 'sql_ltv_forecaster', v_dedup_key
          );
          v_emitted := v_emitted + 1;
        END IF;
      END IF;
    END IF;

    -- Breakout: new cohort ≥ 1.5× median of previous 6 cohorts
    SELECT median(predicted_ltv_12m_cents) INTO v_baseline_median
    FROM (
      SELECT predicted_ltv_12m_cents
      FROM public.ltv_forecasts
      WHERE tenant_id = r.tenant_id
        AND cohort_month < r.cohort_month
      ORDER BY cohort_month DESC
      LIMIT 6
    ) s;

    IF v_baseline_median IS NOT NULL AND v_baseline_median > 0
       AND r.predicted_ltv_12m_cents >= v_baseline_median * 1.5 THEN
      v_dedup_key := ('x' || substr(md5(format('ltv_breakout:%s:%s', r.tenant_id::text, r.cohort_month::text)), 1, 16))::bit(64)::bigint;
      SELECT COUNT(*) INTO v_exists
      FROM public.ai_insights
      WHERE tenant_id = r.tenant_id
        AND insight_type = 'ltv_breakout_cohort'
        AND dedup_bucket = v_dedup_key
        AND created_at > now() - interval '30 days';

      IF v_exists = 0 THEN
        INSERT INTO public.ai_insights
          (tenant_id, insight_type, severity, title, body, metrics, status, agent_id, dedup_bucket)
        VALUES (
          r.tenant_id, 'ltv_breakout_cohort', 'medium',
          format('Когорта %s суттєво кращa за попередні', to_char(r.cohort_month, 'YYYY-MM')),
          format('Прогноз LTV = %s ₴ vs медіана попередніх 6 = %s ₴ (+%s%%). Що ми робили інакше?',
                 round(r.predicted_ltv_12m_cents / 100.0),
                 round(v_baseline_median / 100.0),
                 round((r.predicted_ltv_12m_cents / v_baseline_median - 1) * 100)),
          jsonb_build_object(
            'cohort_month', r.cohort_month,
            'predicted_ltv_12m_cents', r.predicted_ltv_12m_cents,
            'baseline_median_cents', round(v_baseline_median),
            'lift_pct', round((r.predicted_ltv_12m_cents / v_baseline_median - 1) * 100),
            'action', 'owner_review'
          ),
          'open', 'sql_ltv_forecaster', v_dedup_key
        );
        v_emitted := v_emitted + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'emitted', v_emitted, 'ran_at', now());
END;
$$;

-- Schedules
DO $$
BEGIN
  PERFORM cron.unschedule('ltv-forecaster-compute-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('ltv-forecaster-detect-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('ltv-forecaster-compute-daily', '45 3 * * *',
  $$ SELECT public.compute_ltv_forecasts(); $$);

SELECT cron.schedule('ltv-forecaster-detect-daily', '0 4 * * *',
  $$ SELECT public.detect_ltv_signals(); $$);
