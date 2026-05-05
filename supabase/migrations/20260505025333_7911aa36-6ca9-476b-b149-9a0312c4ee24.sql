
CREATE TABLE IF NOT EXISTS public.customer_rfm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  recency_days integer NOT NULL,
  frequency integer NOT NULL,
  monetary_cents bigint NOT NULL,
  r_score smallint NOT NULL,
  f_score smallint NOT NULL,
  m_score smallint NOT NULL,
  rfm_score text NOT NULL,
  segment text NOT NULL,
  avg_cycle_days numeric,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_rfm_unique UNIQUE (tenant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_rfm_tenant_segment ON public.customer_rfm(tenant_id, segment);
CREATE INDEX IF NOT EXISTS idx_customer_rfm_customer ON public.customer_rfm(customer_id);

ALTER TABLE public.customer_rfm ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_read_rfm" ON public.customer_rfm
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = customer_rfm.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "service_role_all_rfm" ON public.customer_rfm
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.compute_customer_rfm()
RETURNS TABLE(out_tenant_id uuid, out_processed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  v_processed integer;
BEGIN
  FOR t IN
    SELECT id FROM public.tenants
    WHERE status IN ('active','pending') AND COALESCE(is_pilot,false) = false
  LOOP
    WITH base AS (
      SELECT
        c.id AS customer_id,
        c.tenant_id,
        c.avg_cycle_days,
        EXTRACT(DAY FROM (now() - MAX(o.paid_at)))::integer AS recency_days,
        COUNT(o.id)::integer AS frequency,
        COALESCE(SUM(o.total_cents),0)::bigint AS monetary_cents
      FROM public.customers c
      LEFT JOIN public.orders o
        ON o.tenant_id = c.tenant_id
       AND o.customer_email = c.email
       AND o.status = 'paid'
       AND o.paid_at >= now() - interval '365 days'
      WHERE c.tenant_id = t.id
      GROUP BY c.id, c.tenant_id, c.avg_cycle_days
      HAVING COUNT(o.id) > 0
    ),
    scored AS (
      SELECT
        b.*,
        (6 - ntile(5) OVER (ORDER BY recency_days ASC))::smallint AS r_score,
        ntile(5) OVER (ORDER BY frequency ASC)::smallint AS f_score,
        ntile(5) OVER (ORDER BY monetary_cents ASC)::smallint AS m_score
      FROM base b
    ),
    classified AS (
      SELECT
        s.*,
        (s.r_score::text || s.f_score::text || s.m_score::text) AS rfm_score,
        CASE
          WHEN s.r_score >= 4 AND s.f_score >= 4 AND s.m_score >= 4 THEN 'Champions'
          WHEN s.r_score >= 3 AND s.f_score >= 3 AND s.m_score >= 3 THEN 'Loyal'
          WHEN s.r_score >= 4 AND s.f_score <= 2 THEN 'New'
          WHEN s.r_score >= 3 AND s.f_score <= 2 AND s.m_score <= 2 THEN 'Promising'
          WHEN s.r_score <= 2 AND s.f_score >= 4 AND s.m_score >= 4 THEN 'Cant Lose'
          WHEN s.r_score <= 2 AND s.f_score >= 3 AND s.m_score >= 3 THEN 'At Risk'
          WHEN s.r_score <= 2 AND s.f_score <= 2 AND s.m_score >= 3 THEN 'Hibernating'
          WHEN s.r_score = 1 AND s.f_score = 1 THEN 'Lost'
          ELSE 'Need Attention'
        END AS segment
      FROM scored s
    )
    INSERT INTO public.customer_rfm
      (tenant_id, customer_id, recency_days, frequency, monetary_cents,
       r_score, f_score, m_score, rfm_score, segment, avg_cycle_days, computed_at)
    SELECT
      tenant_id, customer_id, recency_days, frequency, monetary_cents,
      r_score, f_score, m_score, rfm_score, segment, avg_cycle_days, now()
    FROM classified
    ON CONFLICT (tenant_id, customer_id) DO UPDATE SET
      recency_days = EXCLUDED.recency_days,
      frequency = EXCLUDED.frequency,
      monetary_cents = EXCLUDED.monetary_cents,
      r_score = EXCLUDED.r_score,
      f_score = EXCLUDED.f_score,
      m_score = EXCLUDED.m_score,
      rfm_score = EXCLUDED.rfm_score,
      segment = EXCLUDED.segment,
      avg_cycle_days = EXCLUDED.avg_cycle_days,
      computed_at = now();

    GET DIAGNOSTICS v_processed = ROW_COUNT;
    out_tenant_id := t.id;
    out_processed := v_processed;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_rfm_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  r RECORD;
  v_dedup bigint;
  v_today date := CURRENT_DATE;
BEGIN
  FOR r IN
    SELECT
      rfm.tenant_id, rfm.customer_id, c.email, c.name,
      rfm.segment, rfm.recency_days, rfm.monetary_cents, rfm.avg_cycle_days
    FROM public.customer_rfm rfm
    JOIN public.customers c ON c.id = rfm.customer_id
    JOIN public.tenants t ON t.id = rfm.tenant_id
    WHERE t.status IN ('active','pending') AND COALESCE(t.is_pilot,false) = false
      AND rfm.segment IN ('Champions','Loyal','Cant Lose','At Risk')
      AND rfm.avg_cycle_days IS NOT NULL
      AND rfm.recency_days > GREATEST(rfm.avg_cycle_days * 2, 30)
  LOOP
    v_dedup := abs(hashtext(r.tenant_id::text || ':rfm_vip_at_risk:' || r.customer_id::text || ':' || v_today::text))::bigint;
    INSERT INTO public.ai_insights
      (tenant_id, insight_type, title, description, severity, confidence, data, dedup_bucket, status, created_at)
    SELECT
      r.tenant_id, 'rfm_vip_at_risk',
      'VIP at risk: ' || COALESCE(r.name, r.email, 'customer'),
      format('%s customer %s has not ordered in %s days (avg cycle %s). Lifetime value: $%s. Reach out before they churn.',
        r.segment, COALESCE(r.name, r.email), r.recency_days,
        ROUND(r.avg_cycle_days,1), ROUND(r.monetary_cents/100.0,2)),
      'high', 0.85,
      jsonb_build_object(
        'customer_id', r.customer_id, 'email', r.email, 'segment', r.segment,
        'recency_days', r.recency_days, 'avg_cycle_days', r.avg_cycle_days,
        'monetary_cents', r.monetary_cents, 'action', 'reengage_vip'),
      v_dedup, 'pending', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ai_insights ai
      WHERE ai.tenant_id = r.tenant_id AND ai.dedup_bucket = v_dedup
        AND ai.created_at > now() - interval '7 days');
    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;

  FOR r IN
    SELECT rfm.tenant_id, rfm.customer_id, c.email, c.name,
           rfm.segment, rfm.recency_days, rfm.monetary_cents
    FROM public.customer_rfm rfm
    JOIN public.customers c ON c.id = rfm.customer_id
    JOIN public.tenants t ON t.id = rfm.tenant_id
    WHERE t.status IN ('active','pending') AND COALESCE(t.is_pilot,false) = false
      AND rfm.segment IN ('Hibernating','Lost')
      AND rfm.m_score >= 4
      AND rfm.recency_days BETWEEN 60 AND 180
  LOOP
    v_dedup := abs(hashtext(r.tenant_id::text || ':rfm_winback:' || r.customer_id::text || ':' || v_today::text))::bigint;
    INSERT INTO public.ai_insights
      (tenant_id, insight_type, title, description, severity, confidence, data, dedup_bucket, status, created_at)
    SELECT
      r.tenant_id, 'rfm_winback_candidate',
      'Win-back candidate: ' || COALESCE(r.name, r.email, 'customer'),
      format('Past high-value customer (%s, $%s lifetime) silent for %s days. Send a personalized win-back offer.',
        r.segment, ROUND(r.monetary_cents/100.0,2), r.recency_days),
      'medium', 0.75,
      jsonb_build_object(
        'customer_id', r.customer_id, 'email', r.email, 'segment', r.segment,
        'recency_days', r.recency_days, 'monetary_cents', r.monetary_cents,
        'action', 'winback_campaign'),
      v_dedup, 'pending', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ai_insights ai
      WHERE ai.tenant_id = r.tenant_id AND ai.dedup_bucket = v_dedup
        AND ai.created_at > now() - interval '7 days');
    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('rfm_compute_daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('rfm_signals_hourly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('rfm_compute_daily', '30 3 * * *', $$ SELECT public.compute_customer_rfm(); $$);
SELECT cron.schedule('rfm_signals_hourly', '33 * * * *', $$ SELECT public.detect_rfm_signals(); $$);
