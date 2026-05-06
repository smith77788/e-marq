
-- =========== Table ===========
CREATE TABLE IF NOT EXISTS public.budget_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  channel text NOT NULL,
  current_spend_cents bigint NOT NULL DEFAULT 0,
  recommended_spend_cents bigint NOT NULL DEFAULT 0,
  delta_pct numeric NOT NULL DEFAULT 0,
  recommendation text NOT NULL DEFAULT 'hold', -- scale | cut | hold
  score numeric NOT NULL DEFAULT 0,
  predicted_ltv_cents bigint NOT NULL DEFAULT 0,
  cac_cents bigint NOT NULL DEFAULT 0,
  payback_months numeric,
  n_orders integer NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'low',
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_month, channel)
);

CREATE INDEX IF NOT EXISTS idx_budget_recs_tenant_month
  ON public.budget_recommendations(tenant_id, period_month DESC);

ALTER TABLE public.budget_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "br_select" ON public.budget_recommendations
  FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));

CREATE POLICY "br_sysinsert_block" ON public.budget_recommendations
  FOR INSERT TO authenticated WITH CHECK (is_super_admin());

CREATE POLICY "br_sysupdate_block" ON public.budget_recommendations
  FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY "br_sysdelete_block" ON public.budget_recommendations
  FOR DELETE TO authenticated USING (is_super_admin());

-- =========== compute_budget_recommendations ===========
CREATE OR REPLACE FUNCTION public.compute_budget_recommendations(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period date := date_trunc('month', now())::date;
  v_count integer := 0;
  r record;
  v_score numeric;
  v_rec text;
  v_recommended bigint;
  v_delta numeric;
  v_conf text;
  v_payback numeric;
BEGIN
  -- Aggregate per channel for last 60 days
  FOR r IN
    WITH recent AS (
      SELECT ac.channel,
             SUM(ac.spend_cents)::bigint AS spend_cents,
             SUM(ac.new_customers)::int AS new_customers
      FROM public.acquisition_costs ac
      WHERE ac.tenant_id = p_tenant_id
        AND ac.period_month >= (v_period - INTERVAL '2 months')::date
      GROUP BY ac.channel
    ),
    cohort_agg AS (
      SELECT cm.channel,
             AVG(NULLIF(cm.cac_cents, 0))::bigint AS cac_cents,
             AVG(NULLIF(cm.ltv_12m_cents, 0))::bigint AS ltv_actual,
             SUM(cm.customer_count)::int AS n_orders,
             AVG(cm.payback_month)::numeric AS payback_avg
      FROM public.cac_payback_metrics cm
      WHERE cm.tenant_id = p_tenant_id
        AND cm.cohort_month >= (v_period - INTERVAL '6 months')::date
      GROUP BY cm.channel
    ),
    ltv_agg AS (
      SELECT AVG(lf.predicted_ltv_12m_cents)::bigint AS pred_ltv
      FROM public.ltv_forecasts lf
      WHERE lf.tenant_id = p_tenant_id
        AND lf.cohort_month >= (v_period - INTERVAL '6 months')::date
    )
    SELECT recent.channel,
           recent.spend_cents AS current_spend,
           COALESCE(c.cac_cents, 0) AS cac_cents,
           COALESCE(GREATEST(c.ltv_actual, (SELECT pred_ltv FROM ltv_agg)), 0) AS ltv_cents,
           COALESCE(c.n_orders, recent.new_customers) AS n_orders,
           COALESCE(c.payback_avg,
             CASE WHEN c.cac_cents > 0 AND c.ltv_actual > 0
                  THEN c.cac_cents::numeric / NULLIF(c.ltv_actual, 0) * 12
                  ELSE NULL END) AS payback_months
    FROM recent
    LEFT JOIN cohort_agg c ON c.channel = recent.channel
    WHERE recent.channel IS NOT NULL AND recent.channel <> ''
  LOOP
    -- Confidence
    v_conf := CASE
      WHEN r.n_orders >= 30 THEN 'high'
      WHEN r.n_orders >= 10 THEN 'medium'
      ELSE 'low'
    END;

    v_payback := r.payback_months;

    -- Score
    IF r.cac_cents > 0 AND v_payback IS NOT NULL AND v_payback > 0 THEN
      v_score := (r.ltv_cents::numeric / r.cac_cents) * (1.0 / GREATEST(v_payback, 0.5));
    ELSE
      v_score := 0;
    END IF;

    -- Recommendation
    IF v_conf = 'low' THEN
      v_rec := 'hold';
      v_recommended := r.current_spend;
    ELSIF v_score >= 3.0 AND v_payback IS NOT NULL AND v_payback <= 1.5 THEN
      v_rec := 'scale';
      v_recommended := LEAST((r.current_spend * 1.25)::bigint, (r.current_spend * 1.5)::bigint);
    ELSIF v_score <= 1.0 OR (v_payback IS NOT NULL AND v_payback > 4.0) THEN
      v_rec := 'cut';
      v_recommended := (r.current_spend * 0.7)::bigint;
    ELSE
      v_rec := 'hold';
      v_recommended := r.current_spend;
    END IF;

    v_delta := CASE WHEN r.current_spend > 0
      THEN ((v_recommended - r.current_spend)::numeric / r.current_spend) * 100
      ELSE 0 END;

    INSERT INTO public.budget_recommendations(
      tenant_id, period_month, channel,
      current_spend_cents, recommended_spend_cents, delta_pct,
      recommendation, score, predicted_ltv_cents, cac_cents,
      payback_months, n_orders, confidence, rationale, computed_at)
    VALUES (
      p_tenant_id, v_period, r.channel,
      r.current_spend, v_recommended, v_delta,
      v_rec, v_score, r.ltv_cents, r.cac_cents,
      v_payback, r.n_orders, v_conf,
      jsonb_build_object(
        'score', v_score, 'payback_months', v_payback,
        'ltv_to_cac', CASE WHEN r.cac_cents > 0 THEN r.ltv_cents::numeric / r.cac_cents ELSE null END,
        'window', '60d', 'reason',
        CASE v_rec
          WHEN 'scale' THEN 'High LTV/CAC and fast payback'
          WHEN 'cut' THEN 'Low LTV/CAC or slow payback'
          ELSE 'Within target band' END),
      now())
    ON CONFLICT (tenant_id, period_month, channel) DO UPDATE
      SET current_spend_cents = EXCLUDED.current_spend_cents,
          recommended_spend_cents = EXCLUDED.recommended_spend_cents,
          delta_pct = EXCLUDED.delta_pct,
          recommendation = EXCLUDED.recommendation,
          score = EXCLUDED.score,
          predicted_ltv_cents = EXCLUDED.predicted_ltv_cents,
          cac_cents = EXCLUDED.cac_cents,
          payback_months = EXCLUDED.payback_months,
          n_orders = EXCLUDED.n_orders,
          confidence = EXCLUDED.confidence,
          rationale = EXCLUDED.rationale,
          computed_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- =========== detect_budget_signals ===========
CREATE OR REPLACE FUNCTION public.detect_budget_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
  v_dedup bigint;
  v_week text := to_char(date_trunc('week', now()), 'IYYY-IW');
  v_insight_type text;
  v_severity text;
  v_title text;
  v_description text;
BEGIN
  FOR r IN
    SELECT br.*
    FROM public.budget_recommendations br
    JOIN public.tenants t ON t.id = br.tenant_id
    WHERE br.period_month = date_trunc('month', now())::date
      AND br.recommendation IN ('scale','cut')
      AND br.confidence IN ('high','medium')
      AND COALESCE(t.is_pilot, false) = false
      AND t.status IN ('active','pending')
      AND (br.recommendation = 'scale'
           OR br.current_spend_cents >= 500000) -- 5k UAH
  LOOP
    IF r.recommendation = 'scale' THEN
      v_insight_type := 'budget_scale_winner';
      v_severity := 'medium';
      v_title := format('Масштабувати канал %s на +%s%%',
        r.channel, round(r.delta_pct)::text);
      v_description := format(
        'LTV/CAC = %s, payback ≈ %s міс. Рекомендуємо підняти бюджет з %s до %s грн на місяць.',
        round((r.predicted_ltv_cents::numeric / NULLIF(r.cac_cents,0))::numeric, 2),
        round(COALESCE(r.payback_months,0), 1),
        round(r.current_spend_cents / 100.0)::text,
        round(r.recommended_spend_cents / 100.0)::text);
    ELSE
      v_insight_type := 'budget_cut_loser';
      v_severity := 'high';
      v_title := format('Скоротити канал %s на %s%%',
        r.channel, round(abs(r.delta_pct))::text);
      v_description := format(
        'LTV/CAC = %s, payback ≈ %s міс. Канал не окупається. Знизьте бюджет з %s до %s грн.',
        round((r.predicted_ltv_cents::numeric / NULLIF(r.cac_cents,0))::numeric, 2),
        round(COALESCE(r.payback_months,0), 1),
        round(r.current_spend_cents / 100.0)::text,
        round(r.recommended_spend_cents / 100.0)::text);
    END IF;

    -- Weekly dedup per (tenant, channel, type, week)
    v_dedup := ('x' || substr(md5(format('%s|%s|%s|%s',
      r.tenant_id::text, r.channel, v_insight_type, v_week)), 1, 16))::bit(64)::bigint;

    IF EXISTS (SELECT 1 FROM public.ai_insights
               WHERE tenant_id = r.tenant_id AND dedup_bucket = v_dedup) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.ai_insights(
      tenant_id, insight_type, affected_layer, title, description,
      expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
    VALUES (
      r.tenant_id, v_insight_type, 'marketing', v_title, v_description,
      CASE r.recommendation WHEN 'scale' THEN 'Зростання нових клієнтів'
                            ELSE 'Зекономлений маркетинг-бюджет' END,
      0.7, CASE WHEN r.recommendation = 'cut' THEN 'medium' ELSE 'low' END,
      'open',
      jsonb_build_object(
        'channel', r.channel,
        'recommendation', r.recommendation,
        'current_spend_cents', r.current_spend_cents,
        'recommended_spend_cents', r.recommended_spend_cents,
        'delta_pct', r.delta_pct,
        'score', r.score,
        'payback_months', r.payback_months,
        'confidence', r.confidence,
        'action', 'owner_review'),
      v_dedup);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_budget_recommendations(uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.detect_budget_signals() TO postgres, service_role;

-- =========== Cron ===========
SELECT cron.unschedule('budget-recommender-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'budget-recommender-daily');

SELECT cron.schedule(
  'budget-recommender-daily',
  '15 5 * * *',
  $cron$
  DO $$
  DECLARE t record;
  BEGIN
    FOR t IN SELECT id FROM public.tenants WHERE status IN ('active','pending') LOOP
      PERFORM public.compute_budget_recommendations(t.id);
    END LOOP;
    PERFORM public.detect_budget_signals();
  END $$;
  $cron$
);
