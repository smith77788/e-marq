
DROP FUNCTION IF EXISTS public.compute_customer_ltv();

CREATE OR REPLACE FUNCTION public.compute_customer_ltv()
RETURNS TABLE(out_tenant_id uuid, customers_scored integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      c.tenant_id AS t_id,
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
      b.t_id,
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
      t.t_id, t.customer_id, t.predicted_ltv_cents, t.predicted_orders_12m,
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
    RETURNING customer_ltv_scores.tenant_id AS rt_tenant_id
  )
  SELECT u.rt_tenant_id, COUNT(*)::int FROM upsert u GROUP BY u.rt_tenant_id;
END;
$$;
