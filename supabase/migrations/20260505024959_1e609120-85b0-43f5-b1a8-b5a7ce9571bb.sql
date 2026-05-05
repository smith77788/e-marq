
CREATE OR REPLACE FUNCTION public.detect_funnel_anomalies()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant RECORD;
  v_row RECORD;
  v_inserted int := 0;
  v_skipped int := 0;
  v_z_threshold numeric := 2.5;
  v_min_visits int := 50;       -- ignore noisy low-traffic days
  v_dedup bigint;
BEGIN
  FOR v_tenant IN
    SELECT id FROM public.tenants
     WHERE status IN ('active','pending')
       AND COALESCE(is_pilot,false) = false
  LOOP
    -- Compute 14d stats per tenant, then check the latest complete day
    FOR v_row IN
      WITH stats AS (
        SELECT
          tenant_id,
          AVG(NULLIF(visits,0))::numeric AS avg_visits,
          STDDEV_SAMP(NULLIF(visits,0))::numeric AS sd_visits,
          AVG(CASE WHEN visits>0 THEN paid_orders::numeric / visits END) AS avg_cvr,
          STDDEV_SAMP(CASE WHEN visits>0 THEN paid_orders::numeric / visits END) AS sd_cvr,
          AVG(NULLIF(revenue_cents,0))::numeric AS avg_rev,
          STDDEV_SAMP(NULLIF(revenue_cents,0))::numeric AS sd_rev,
          AVG(NULLIF(paid_orders,0))::numeric AS avg_orders,
          STDDEV_SAMP(NULLIF(paid_orders,0))::numeric AS sd_orders
        FROM public.funnel_metrics_14d
        WHERE tenant_id = v_tenant.id
          AND day < CURRENT_DATE  -- exclude today (incomplete)
          AND day >= CURRENT_DATE - 14
        GROUP BY tenant_id
      ),
      latest AS (
        SELECT *
        FROM public.funnel_metrics_14d
        WHERE tenant_id = v_tenant.id
          AND day = CURRENT_DATE - 1
      )
      SELECT l.day, l.visits, l.paid_orders, l.revenue_cents,
             CASE WHEN l.visits>0 THEN l.paid_orders::numeric/l.visits END AS cvr,
             s.avg_cvr, s.sd_cvr, s.avg_rev, s.sd_rev, s.avg_orders, s.sd_orders
      FROM latest l, stats s
    LOOP
      EXIT WHEN v_row.day IS NULL;

      -- Skip low-traffic noise
      IF v_row.visits < v_min_visits THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- 1. Conversion rate drop
      IF v_row.sd_cvr > 0 AND v_row.avg_cvr > 0 AND v_row.cvr IS NOT NULL THEN
        IF (v_row.avg_cvr - v_row.cvr) / v_row.sd_cvr > v_z_threshold THEN
          v_dedup := abs(hashtext(v_tenant.id::text || '|anomaly_conversion_drop|' || v_row.day::text))::bigint;
          INSERT INTO public.ai_insights (
            tenant_id, insight_type, affected_layer, title, description,
            expected_impact, confidence, risk_level, status, metrics, dedup_bucket
          ) VALUES (
            v_tenant.id, 'anomaly_conversion_drop', 'funnel',
            format('Різке падіння конверсії %s', v_row.day),
            format('Conversion %s%% проти 14d-середнього %s%% (z=%s). Перевірте чекаут / payment / fraud.',
                   round(v_row.cvr*100, 2), round(v_row.avg_cvr*100, 2),
                   round((v_row.avg_cvr - v_row.cvr) / v_row.sd_cvr, 2)),
            'high', LEAST(0.95, 0.5 + (v_row.avg_cvr - v_row.cvr)/v_row.sd_cvr/10),
            'high', 'new',
            jsonb_build_object('day', v_row.day, 'cvr', v_row.cvr, 'avg_cvr', v_row.avg_cvr,
                               'z_score', round((v_row.avg_cvr - v_row.cvr) / v_row.sd_cvr, 2),
                               'visits', v_row.visits, 'paid_orders', v_row.paid_orders),
            v_dedup
          )
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_inserted := v_inserted + 1; END IF;
        END IF;
      END IF;

      -- 2. Revenue collapse
      IF v_row.sd_rev > 0 AND v_row.avg_rev > 0 THEN
        IF (v_row.avg_rev - v_row.revenue_cents) / v_row.sd_rev > v_z_threshold THEN
          v_dedup := abs(hashtext(v_tenant.id::text || '|anomaly_revenue_drop|' || v_row.day::text))::bigint;
          INSERT INTO public.ai_insights (
            tenant_id, insight_type, affected_layer, title, description,
            expected_impact, confidence, risk_level, status, metrics, dedup_bucket
          ) VALUES (
            v_tenant.id, 'anomaly_revenue_drop', 'funnel',
            format('Обвал доходу %s', v_row.day),
            format('Revenue $%s проти 14d-середнього $%s (z=%s).',
                   round(v_row.revenue_cents/100.0, 2), round(v_row.avg_rev/100.0, 2),
                   round((v_row.avg_rev - v_row.revenue_cents) / v_row.sd_rev, 2)),
            'high', LEAST(0.95, 0.5 + (v_row.avg_rev - v_row.revenue_cents)/v_row.sd_rev/10),
            'high', 'new',
            jsonb_build_object('day', v_row.day, 'revenue_cents', v_row.revenue_cents,
                               'avg_revenue_cents', round(v_row.avg_rev),
                               'z_score', round((v_row.avg_rev - v_row.revenue_cents) / v_row.sd_rev, 2)),
            v_dedup
          )
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_inserted := v_inserted + 1; END IF;
        END IF;
      END IF;

      -- 3. Orders collapse
      IF v_row.sd_orders > 0 AND v_row.avg_orders > 0 THEN
        IF (v_row.avg_orders - v_row.paid_orders) / v_row.sd_orders > v_z_threshold THEN
          v_dedup := abs(hashtext(v_tenant.id::text || '|anomaly_orders_drop|' || v_row.day::text))::bigint;
          INSERT INTO public.ai_insights (
            tenant_id, insight_type, affected_layer, title, description,
            expected_impact, confidence, risk_level, status, metrics, dedup_bucket
          ) VALUES (
            v_tenant.id, 'anomaly_orders_drop', 'funnel',
            format('Обвал кількості замовлень %s', v_row.day),
            format('Paid orders %s проти 14d-середнього %s (z=%s).',
                   v_row.paid_orders, round(v_row.avg_orders, 1),
                   round((v_row.avg_orders - v_row.paid_orders) / v_row.sd_orders, 2)),
            'high', LEAST(0.95, 0.5 + (v_row.avg_orders - v_row.paid_orders)/v_row.sd_orders/10),
            'medium', 'new',
            jsonb_build_object('day', v_row.day, 'paid_orders', v_row.paid_orders,
                               'avg_orders', round(v_row.avg_orders, 1),
                               'z_score', round((v_row.avg_orders - v_row.paid_orders) / v_row.sd_orders, 2)),
            v_dedup
          )
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_inserted := v_inserted + 1; END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped_low_traffic', v_skipped, 'at', now());
END;
$function$;

-- Hourly cron
SELECT cron.schedule(
  'detect-funnel-anomalies-hourly',
  '23 * * * *',
  $cron$ SELECT public.detect_funnel_anomalies(); $cron$
);
