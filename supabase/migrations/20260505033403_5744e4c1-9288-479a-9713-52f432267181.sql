
-- ============================================================
-- SQL Agent #14: Customer LTV
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_customer_ltv()
RETURNS TABLE(tenant_id uuid, customers_scored integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      c.tenant_id,
      c.id AS customer_id,
      c.total_orders,
      c.avg_order_cents,
      c.first_order_at,
      c.last_order_at,
      c.avg_cycle_days,
      GREATEST(30, EXTRACT(EPOCH FROM (COALESCE(c.last_order_at, now()) - COALESCE(c.first_order_at, now() - interval '30 days'))) / 86400.0) AS active_days,
      EXTRACT(EPOCH FROM (now() - COALESCE(c.last_order_at, c.first_order_at, now()))) / 86400.0 AS days_since_last_order
    FROM customers c
    WHERE c.total_orders >= 1
  ),
  scored AS (
    SELECT
      b.tenant_id,
      b.customer_id,
      b.avg_order_cents,
      GREATEST(1, ROUND(b.total_orders * 365.0 / NULLIF(b.active_days,0))::int) AS predicted_orders_12m,
      ROUND(COALESCE(b.avg_order_cents,0) * GREATEST(1, b.total_orders * 365.0 / NULLIF(b.active_days,0)))::int AS predicted_ltv_cents,
      LEAST(0.99, GREATEST(0.0,
        CASE
          WHEN b.avg_cycle_days IS NULL OR b.avg_cycle_days <= 0 THEN
            LEAST(0.95, b.days_since_last_order / 180.0)
          ELSE
            LEAST(0.99, GREATEST(0.0, (b.days_since_last_order - b.avg_cycle_days) / (b.avg_cycle_days * 2.0)))
        END
      ))::numeric(5,4) AS churn_probability,
      CASE
        WHEN b.avg_cycle_days IS NOT NULL AND b.days_since_last_order > b.avg_cycle_days * 2 THEN 'overdue_cycle'
        WHEN b.days_since_last_order > 90 THEN 'long_silence'
        WHEN b.total_orders = 1 AND b.days_since_last_order > 45 THEN 'one_and_done_risk'
        ELSE 'active'
      END AS churn_reason
    FROM base b
  ),
  tiered AS (
    SELECT
      s.*,
      CASE
        WHEN s.predicted_ltv_cents >= 5000000 THEN 'platinum'
        WHEN s.predicted_ltv_cents >= 2000000 THEN 'gold'
        WHEN s.predicted_ltv_cents >= 500000 THEN 'silver'
        ELSE 'bronze'
      END AS segment
    FROM scored s
  ),
  upsert AS (
    INSERT INTO customer_ltv_scores (
      tenant_id, customer_id, predicted_ltv_cents, predicted_orders_12m,
      churn_probability, churn_reason, segment, computed_at
    )
    SELECT
      t.tenant_id, t.customer_id, t.predicted_ltv_cents, t.predicted_orders_12m,
      t.churn_probability, t.churn_reason, t.segment, now()
    FROM tiered t
    ON CONFLICT (tenant_id, customer_id) DO UPDATE SET
      predicted_ltv_cents = EXCLUDED.predicted_ltv_cents,
      predicted_orders_12m = EXCLUDED.predicted_orders_12m,
      churn_probability = EXCLUDED.churn_probability,
      churn_reason = EXCLUDED.churn_reason,
      segment = EXCLUDED.segment,
      computed_at = now(),
      updated_at = now()
    RETURNING tenant_id
  )
  SELECT u.tenant_id, COUNT(*)::int FROM upsert u GROUP BY u.tenant_id;
END;
$$;

-- Ensure unique constraint for upsert
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_ltv_scores_tenant_customer_uniq'
  ) THEN
    BEGIN
      ALTER TABLE public.customer_ltv_scores
        ADD CONSTRAINT customer_ltv_scores_tenant_customer_uniq UNIQUE (tenant_id, customer_id);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- ============================================================
-- Detector: High-LTV at-risk customers → priority winback
-- ============================================================
CREATE OR REPLACE FUNCTION public.detect_high_ltv_at_risk()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH candidates AS (
    SELECT
      l.tenant_id,
      l.customer_id,
      l.predicted_ltv_cents,
      l.churn_probability,
      l.segment,
      c.email,
      c.name
    FROM customer_ltv_scores l
    JOIN customers c ON c.id = l.customer_id
    WHERE l.segment IN ('gold','platinum')
      AND l.churn_probability >= 0.5
      AND c.consent_marketing = true
  ),
  inserted AS (
    INSERT INTO ai_insights (
      tenant_id, insight_type, title, description, confidence,
      severity, status, payload, dedup_bucket, customer_id
    )
    SELECT
      cd.tenant_id,
      'high_ltv_at_risk',
      'High-LTV клієнт під ризиком: ' || COALESCE(cd.name, cd.email, 'клієнт'),
      'Сегмент ' || cd.segment || ', прогноз LTV ' || ROUND(cd.predicted_ltv_cents/100.0)::text
        || ' UAH, ймовірність відтоку ' || ROUND(cd.churn_probability*100)::text || '%. Рекомендований персональний winback.',
      LEAST(0.9, 0.5 + cd.churn_probability * 0.4),
      CASE WHEN cd.segment = 'platinum' THEN 'high' ELSE 'medium' END,
      'pending',
      jsonb_build_object(
        'action', 'priority_winback',
        'segment', cd.segment,
        'predicted_ltv_cents', cd.predicted_ltv_cents,
        'churn_probability', cd.churn_probability,
        'customer_id', cd.customer_id
      ),
      ('x' || substr(md5('high_ltv_at_risk:' || cd.tenant_id::text || ':' || cd.customer_id::text || ':' || to_char(now(), 'IYYY-IW')), 1, 16))::bit(64)::bigint,
      cd.customer_id
    FROM candidates cd
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id = cd.tenant_id
        AND ai.insight_type = 'high_ltv_at_risk'
        AND ai.customer_id = cd.customer_id
        AND ai.created_at > now() - interval '7 days'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;

  RETURN v_count;
END;
$$;

-- ============================================================
-- Map insight → action
-- ============================================================
CREATE OR REPLACE FUNCTION public._map_insight_to_action(_insight_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _insight_type
    WHEN 'stockout_imminent' THEN 'replenish_alert'
    WHEN 'low_stock' THEN 'replenish_alert'
    WHEN 'dead_stock' THEN 'discount_dead_stock'
    WHEN 'vip_silent' THEN 'priority_winback'
    WHEN 'rfm_vip_at_risk' THEN 'priority_winback'
    WHEN 'rfm_winback_candidate' THEN 'winback_campaign'
    WHEN 'bundle_opportunity' THEN 'create_bundle'
    WHEN 'trending_product' THEN 'feature_product'
    WHEN 'high_ltv_at_risk' THEN 'priority_winback'
    WHEN 'replenish_alert' THEN 'replenish_alert'
    ELSE 'owner_review'
  END;
$$;

-- ============================================================
-- Schedule
-- ============================================================
DO $$ BEGIN
  PERFORM cron.unschedule('compute-customer-ltv-daily');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('detect-high-ltv-at-risk-hourly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'compute-customer-ltv-daily',
  '20 3 * * *',
  $$ SELECT public.compute_customer_ltv(); $$
);

SELECT cron.schedule(
  'detect-high-ltv-at-risk-hourly',
  '37 * * * *',
  $$ SELECT public.detect_high_ltv_at_risk(); $$
);
