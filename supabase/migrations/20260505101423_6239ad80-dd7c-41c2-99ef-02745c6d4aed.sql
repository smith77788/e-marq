
CREATE OR REPLACE FUNCTION public.compute_customer_cohorts()
RETURNS TABLE(tenant_id uuid, cohorts_written integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
  v_count integer;
BEGIN
  FOR t IN
    SELECT id FROM public.tenants
    WHERE status IN ('active','pending')
      AND COALESCE(is_pilot, false) = false
  LOOP
    WITH first_orders AS (
      SELECT
        c.id AS customer_id,
        date_trunc('month', c.first_order_at)::date AS cohort_month
      FROM public.customers c
      WHERE c.tenant_id = t.id
        AND c.first_order_at IS NOT NULL
        AND c.first_order_at >= date_trunc('month', now() - interval '11 months')
    ),
    cohort_orders AS (
      SELECT
        fo.cohort_month,
        fo.customer_id,
        date_trunc('month', o.created_at)::date AS order_month,
        o.total_cents
      FROM first_orders fo
      JOIN public.orders o ON o.customer_id = fo.customer_id
      WHERE o.tenant_id = t.id
        AND o.status IN ('paid','fulfilled','delivered','shipped','completed')
    ),
    monthly AS (
      SELECT
        cohort_month,
        ((EXTRACT(YEAR FROM order_month) - EXTRACT(YEAR FROM cohort_month)) * 12
          + (EXTRACT(MONTH FROM order_month) - EXTRACT(MONTH FROM cohort_month)))::int AS month_offset,
        COUNT(DISTINCT customer_id)::int AS active_customers,
        COALESCE(SUM(total_cents),0)::bigint AS revenue_cents
      FROM cohort_orders
      WHERE order_month >= cohort_month
      GROUP BY cohort_month, 2
    ),
    sizes AS (
      SELECT cohort_month, COUNT(*)::int AS customer_count
      FROM first_orders
      GROUP BY cohort_month
    ),
    curves AS (
      SELECT
        s.cohort_month,
        s.customer_count,
        COALESCE(
          jsonb_agg(jsonb_build_object('m', m.month_offset, 'c', m.active_customers)
                    ORDER BY m.month_offset)
            FILTER (WHERE m.month_offset IS NOT NULL),
          '[]'::jsonb
        ) AS retention_curve,
        COALESCE(
          jsonb_agg(jsonb_build_object('m', m.month_offset, 'r', m.revenue_cents)
                    ORDER BY m.month_offset)
            FILTER (WHERE m.month_offset IS NOT NULL),
          '[]'::jsonb
        ) AS revenue_curve
      FROM sizes s
      LEFT JOIN monthly m ON m.cohort_month = s.cohort_month
      GROUP BY s.cohort_month, s.customer_count
    ),
    upserted AS (
      INSERT INTO public.customer_cohorts
        (tenant_id, cohort_month, customer_count, retention_curve, revenue_curve, computed_at)
      SELECT t.id, c.cohort_month, c.customer_count, c.retention_curve, c.revenue_curve, now()
      FROM curves c
      ON CONFLICT (tenant_id, cohort_month) DO UPDATE
        SET customer_count = EXCLUDED.customer_count,
            retention_curve = EXCLUDED.retention_curve,
            revenue_curve = EXCLUDED.revenue_curve,
            computed_at = now()
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM upserted;

    tenant_id := t.id;
    cohorts_written := COALESCE(v_count, 0);
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

SELECT cron.unschedule('compute-cohorts-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname='compute-cohorts-daily'
);

SELECT cron.schedule(
  'compute-cohorts-daily',
  '45 3 * * *',
  $$ SELECT public.compute_customer_cohorts(); $$
);
