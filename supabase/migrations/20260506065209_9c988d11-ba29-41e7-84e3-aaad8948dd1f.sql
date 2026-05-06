
CREATE OR REPLACE FUNCTION public.detect_cohort_retention_drops()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  r record;
  v_baseline_m1 numeric;
  v_baseline_m3 numeric;
  v_m1 numeric;
  v_m3 numeric;
  v_drop_m1 numeric;
  v_drop_m3 numeric;
  v_dedup bigint;
  v_title text;
  v_desc text;
  v_severity text;
BEGIN
  FOR r IN
    SELECT cc.tenant_id, cc.cohort_month, cc.customer_count, cc.retention_curve
    FROM public.customer_cohorts cc
    JOIN public.tenants t ON t.id = cc.tenant_id
    WHERE COALESCE(t.is_pilot, false) = false
      AND t.status IN ('active','pending')
      AND cc.cohort_month >= (date_trunc('month', now()) - interval '6 months')::date
      AND cc.cohort_month <= (date_trunc('month', now()) - interval '1 month')::date
      AND cc.customer_count >= 20
  LOOP
    -- m1 / m3 from current cohort retention curve (jsonb array of pct)
    BEGIN
      v_m1 := (r.retention_curve->>1)::numeric;
      v_m3 := (r.retention_curve->>3)::numeric;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    IF v_m1 IS NULL THEN CONTINUE; END IF;

    -- baseline: median m1/m3 across previous 6 cohorts of same tenant
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (retention_curve->>1)::numeric),
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (retention_curve->>3)::numeric)
    INTO v_baseline_m1, v_baseline_m3
    FROM public.customer_cohorts
    WHERE tenant_id = r.tenant_id
      AND cohort_month < r.cohort_month
      AND cohort_month >= (r.cohort_month - interval '7 months')::date
      AND customer_count >= 10;

    IF v_baseline_m1 IS NULL OR v_baseline_m1 <= 0 THEN CONTINUE; END IF;

    v_drop_m1 := CASE WHEN v_baseline_m1 > 0 THEN 1 - (v_m1 / v_baseline_m1) ELSE 0 END;
    v_drop_m3 := CASE WHEN v_baseline_m3 IS NOT NULL AND v_baseline_m3 > 0 AND v_m3 IS NOT NULL
                       THEN 1 - (v_m3 / v_baseline_m3) ELSE 0 END;

    IF v_drop_m1 < 0.30 AND v_drop_m3 < 0.40 THEN CONTINUE; END IF;

    v_severity := CASE WHEN v_drop_m1 >= 0.50 OR v_drop_m3 >= 0.55 THEN 'high' ELSE 'medium' END;
    v_dedup := ('x' || substr(md5('cohort_drop::' || r.tenant_id::text || '::' || r.cohort_month::text), 1, 15))::bit(60)::bigint;

    v_title := format('Когорта %s: повторні покупки впали на %s%%',
                      to_char(r.cohort_month, 'YYYY-MM'),
                      round(v_drop_m1 * 100)::text);
    v_desc := format(
      'M1 retention %s%% проти базового %s%% (медіана попередніх 6 когорт). M3: %s%% проти %s%%. Когорта з %s клієнтів. Варто перевірити: якість onboarding, якість продукту, шипінг-досвід, win-back ланцюжки.',
      round(v_m1 * 100)::text,
      round(v_baseline_m1 * 100)::text,
      COALESCE(round(v_m3 * 100)::text, '—'),
      COALESCE(round(v_baseline_m3 * 100)::text, '—'),
      r.customer_count
    );

    INSERT INTO public.ai_insights (
      tenant_id, insight_type, affected_layer, title, description,
      expected_impact, confidence, risk_level, metrics, dedup_bucket, status
    )
    SELECT
      r.tenant_id,
      'cohort_retention_drop',
      'crm',
      v_title,
      v_desc,
      format('Повернення M1 до базового рівня дасть ~%s додаткових повторних замовлень/міс на цій когорті.',
             round((v_baseline_m1 - v_m1) * r.customer_count)::text),
      0.75,
      v_severity,
      jsonb_build_object(
        'cohort_month', r.cohort_month,
        'customer_count', r.customer_count,
        'm1_retention', v_m1,
        'm1_baseline', v_baseline_m1,
        'm1_drop_pct', v_drop_m1,
        'm3_retention', v_m3,
        'm3_baseline', v_baseline_m3,
        'm3_drop_pct', v_drop_m3,
        'action', 'owner_review'
      ),
      v_dedup,
      'new'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ai_insights ai
      WHERE ai.tenant_id = r.tenant_id
        AND ai.dedup_bucket = v_dedup
        AND ai.created_at > now() - interval '30 days'
    );

    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- Schedule daily 04:15 UTC (after cohort engine which runs earlier)
SELECT cron.schedule(
  'detect-cohort-retention-drops-daily',
  '15 4 * * *',
  $$ SELECT public.detect_cohort_retention_drops(); $$
);
