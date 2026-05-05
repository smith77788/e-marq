
CREATE TABLE IF NOT EXISTS public.inventory_velocity_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  current_stock integer NOT NULL,
  velocity_14d numeric NOT NULL DEFAULT 0,
  velocity_30d numeric NOT NULL DEFAULT 0,
  velocity_90d numeric NOT NULL DEFAULT 0,
  weighted_velocity numeric NOT NULL DEFAULT 0,
  days_until_stockout numeric,
  projected_stockout_date date,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_velocity_forecasts_unique UNIQUE (tenant_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_invvf_tenant ON public.inventory_velocity_forecasts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invvf_stockout ON public.inventory_velocity_forecasts(tenant_id, days_until_stockout);

ALTER TABLE public.inventory_velocity_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_read_invvf" ON public.inventory_velocity_forecasts
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_memberships tm
            WHERE tm.tenant_id = inventory_velocity_forecasts.tenant_id
              AND tm.user_id = auth.uid())
  );

CREATE POLICY "service_role_all_invvf" ON public.inventory_velocity_forecasts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.compute_inventory_velocity_forecasts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int := 0;
BEGIN
  WITH velocities AS (
    SELECT
      p.tenant_id, p.id AS product_id, p.stock,
      COALESCE(SUM(oi.quantity) FILTER (WHERE o.paid_at >= now() - interval '14 days'),0)::numeric / 14.0 AS v14,
      COALESCE(SUM(oi.quantity) FILTER (WHERE o.paid_at >= now() - interval '30 days'),0)::numeric / 30.0 AS v30,
      COALESCE(SUM(oi.quantity) FILTER (WHERE o.paid_at >= now() - interval '90 days'),0)::numeric / 90.0 AS v90
    FROM public.products p
    JOIN public.tenants t ON t.id = p.tenant_id
    LEFT JOIN public.order_items oi
      ON oi.product_id = p.id AND oi.tenant_id = p.tenant_id
    LEFT JOIN public.orders o
      ON o.id = oi.order_id AND o.status = 'paid'
     AND o.paid_at >= now() - interval '90 days'
    WHERE p.is_active = true
      AND COALESCE(p.stock,0) > 0
      AND t.status IN ('active','pending')
      AND COALESCE(t.is_pilot,false) = false
    GROUP BY p.tenant_id, p.id, p.stock
  ),
  scored AS (
    SELECT *,
      ((CASE WHEN v14 > 0 THEN 0.5 ELSE 0 END)*v14
       + (CASE WHEN v30 > 0 THEN 0.3 ELSE 0 END)*v30
       + (CASE WHEN v90 > 0 THEN 0.2 ELSE 0 END)*v90) AS w_v
    FROM velocities
  )
  INSERT INTO public.inventory_velocity_forecasts
    (tenant_id, product_id, current_stock, velocity_14d, velocity_30d, velocity_90d,
     weighted_velocity, days_until_stockout, projected_stockout_date, computed_at)
  SELECT
    tenant_id, product_id, stock, v14, v30, v90,
    w_v,
    CASE WHEN w_v > 0 THEN ROUND((stock / w_v)::numeric, 1) ELSE NULL END,
    CASE WHEN w_v > 0 THEN (CURRENT_DATE + LEAST((stock / w_v)::int, 3650)) ELSE NULL END,
    now()
  FROM scored
  ON CONFLICT (tenant_id, product_id) DO UPDATE SET
    current_stock = EXCLUDED.current_stock,
    velocity_14d = EXCLUDED.velocity_14d,
    velocity_30d = EXCLUDED.velocity_30d,
    velocity_90d = EXCLUDED.velocity_90d,
    weighted_velocity = EXCLUDED.weighted_velocity,
    days_until_stockout = EXCLUDED.days_until_stockout,
    projected_stockout_date = EXCLUDED.projected_stockout_date,
    computed_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_stockout_forecast_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  r RECORD;
  v_dedup bigint;
  v_week text := to_char(date_trunc('week', CURRENT_DATE), 'IYYY-IW');
  v_severity text;
BEGIN
  FOR r IN
    SELECT f.tenant_id, f.product_id, f.current_stock, f.weighted_velocity,
           f.days_until_stockout, f.projected_stockout_date,
           p.name AS product_name, p.sku
      FROM public.inventory_velocity_forecasts f
      JOIN public.products p ON p.id = f.product_id
      JOIN public.tenants t ON t.id = f.tenant_id
     WHERE t.status IN ('active','pending')
       AND COALESCE(t.is_pilot,false) = false
       AND p.is_active = true
       AND f.days_until_stockout IS NOT NULL
       AND f.days_until_stockout > 0
       AND f.days_until_stockout <= 14
       AND f.weighted_velocity > 0
  LOOP
    v_severity := CASE WHEN r.days_until_stockout <= 7 THEN 'high' ELSE 'medium' END;
    v_dedup := abs(hashtext(r.tenant_id::text || ':replenish_alert:' || r.product_id::text || ':' || v_week))::bigint;

    INSERT INTO public.ai_insights
      (tenant_id, insight_type, title, description, severity, confidence, data, dedup_bucket, status, created_at)
    SELECT
      r.tenant_id, 'replenish_alert',
      format('Stockout in ~%s days: %s', ROUND(r.days_until_stockout)::int, COALESCE(r.product_name, r.sku, 'product')),
      format('Current stock %s units. Selling ~%s/day (weighted). Projected stockout: %s. Reorder now.',
             r.current_stock, ROUND(r.weighted_velocity,2), r.projected_stockout_date),
      v_severity, 0.8,
      jsonb_build_object(
        'product_id', r.product_id,
        'sku', r.sku,
        'current_stock', r.current_stock,
        'weighted_velocity', r.weighted_velocity,
        'days_until_stockout', r.days_until_stockout,
        'projected_stockout_date', r.projected_stockout_date,
        'action', 'replenish_inventory'),
      v_dedup, 'pending', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ai_insights ai
       WHERE ai.tenant_id = r.tenant_id
         AND ai.dedup_bucket = v_dedup
         AND ai.created_at > now() - interval '7 days'
    );
    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;
  RETURN v_inserted;
END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('inventory_velocity_compute'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('inventory_stockout_signals'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('inventory_velocity_compute', '7 * * * *', $$ SELECT public.compute_inventory_velocity_forecasts(); $$);
SELECT cron.schedule('inventory_stockout_signals', '12 * * * *', $$ SELECT public.detect_stockout_forecast_signals(); $$);
