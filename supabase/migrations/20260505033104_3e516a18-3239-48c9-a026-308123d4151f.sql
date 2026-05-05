CREATE OR REPLACE FUNCTION public.detect_trending_products()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_inserted int := 0;
BEGIN
  WITH velocity AS (
    SELECT
      oi.tenant_id, oi.product_id,
      SUM(CASE WHEN o.created_at > now() - interval '7d' THEN oi.quantity ELSE 0 END)::numeric AS units_7d,
      SUM(CASE WHEN o.created_at > now() - interval '30d' AND o.created_at <= now() - interval '7d'
               THEN oi.quantity ELSE 0 END)::numeric AS units_prior_23d,
      SUM(CASE WHEN o.created_at > now() - interval '7d' THEN oi.quantity * oi.unit_price_cents ELSE 0 END)::bigint AS rev_7d_cents
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at > now() - interval '30d'
      AND o.status IN ('paid','fulfilled','completed','shipped','delivered')
    GROUP BY oi.tenant_id, oi.product_id
  ),
  ranked AS (
    SELECT v.*, p.name AS product_name,
      CASE WHEN v.units_prior_23d > 0
           THEN v.units_7d / (v.units_prior_23d / 23.0 * 7.0) ELSE NULL END AS ratio
    FROM velocity v
    JOIN products p ON p.id = v.product_id AND p.tenant_id = v.tenant_id
    WHERE v.units_7d >= 5 AND p.is_active = true
  )
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT r.tenant_id, 'trending_product', 'product',
    '🔥 Тренд: ' || r.product_name,
    'Продажі за 7д зросли в ' || ROUND(r.ratio, 1) || 'x (' || r.units_7d::int || ' шт., ' ||
      ROUND(r.rev_7d_cents/100.0, 0) || ' ₴). Підняти на головну.',
    'Очікую +20–40% revenue при featured на homepage 7 днів.',
    LEAST(0.85, 0.5 + 0.05 * LN(GREATEST(r.units_7d, 1))),
    'low', 'new',
    jsonb_build_object('product_id', r.product_id, 'units_7d', r.units_7d,
      'units_prior_23d', r.units_prior_23d, 'velocity_ratio', ROUND(r.ratio, 2),
      'revenue_7d_cents', r.rev_7d_cents, 'action', 'feature_on_homepage'),
    ('x' || md5('trending_product:' || r.tenant_id::text || ':' || r.product_id::text || ':' ||
                to_char(date_trunc('week', now()), 'IYYY-IW')))::bit(63)::bigint
  FROM ranked r
  WHERE r.ratio >= 1.5
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai WHERE ai.tenant_id = r.tenant_id
        AND ai.insight_type = 'trending_product'
        AND ai.metrics->>'product_id' = r.product_id::text
        AND ai.created_at > now() - interval '7d'
    );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'computed_at', now());
END $$;