CREATE OR REPLACE FUNCTION public.detect_trending_products()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH velocity AS (
    SELECT
      oi.tenant_id,
      oi.product_id,
      SUM(CASE WHEN o.created_at > now() - interval '7d' THEN oi.quantity ELSE 0 END)::numeric AS units_7d,
      SUM(CASE WHEN o.created_at > now() - interval '30d' AND o.created_at <= now() - interval '7d'
               THEN oi.quantity ELSE 0 END)::numeric AS units_prior_23d,
      SUM(CASE WHEN o.created_at > now() - interval '7d' THEN oi.quantity * oi.unit_price_cents ELSE 0 END)::bigint AS rev_7d_cents
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at > now() - interval '30d'
      AND o.payment_status IN ('paid','fulfilled')
    GROUP BY oi.tenant_id, oi.product_id
  ),
  ranked AS (
    SELECT
      v.tenant_id, v.product_id, v.units_7d, v.units_prior_23d, v.rev_7d_cents,
      -- prior daily rate * 7 = expected_7d
      CASE WHEN v.units_prior_23d > 0
           THEN v.units_7d / (v.units_prior_23d / 23.0 * 7.0)
           ELSE NULL END AS ratio,
      p.name AS product_name,
      p.is_active
    FROM velocity v
    JOIN products p ON p.id = v.product_id
    WHERE v.units_7d >= 5
      AND p.is_active = true
      AND p.tenant_id = v.tenant_id
  )
  INSERT INTO ai_insights (
    tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket
  )
  SELECT
    r.tenant_id,
    'trending_product',
    'product',
    '🔥 Тренд: ' || r.product_name,
    'За останні 7 днів продажі цього товару зросли в ' || ROUND(r.ratio, 1) ||
    'x проти попередніх 23 днів (' || r.units_7d::int || ' шт., ' ||
    ROUND(r.rev_7d_cents/100.0, 0) || ' ₴). Рекомендую підняти на головну.',
    'Очікую +20–40% revenue від цього SKU при показі на homepage 7 днів.',
    LEAST(0.85, 0.5 + 0.05 * LN(GREATEST(r.units_7d, 1))),
    'low',
    'new',
    jsonb_build_object(
      'product_id', r.product_id,
      'units_7d', r.units_7d,
      'units_prior_23d', r.units_prior_23d,
      'velocity_ratio', ROUND(r.ratio, 2),
      'revenue_7d_cents', r.rev_7d_cents,
      'action', 'feature_on_homepage'
    ),
    ('x' || md5('trending_product:' || r.tenant_id::text || ':' || r.product_id::text || ':' ||
                to_char(date_trunc('week', now()), 'IYYY-IW')))::bit(63)::bigint
  FROM ranked r
  WHERE r.ratio >= 1.5
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id = r.tenant_id
        AND ai.insight_type = 'trending_product'
        AND ai.metrics->>'product_id' = r.product_id::text
        AND ai.created_at > now() - interval '7d'
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'computed_at', now());
END;
$$;

-- Map insight to feature_product action
CREATE OR REPLACE FUNCTION public._map_insight_to_action(_insight_type text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE _insight_type
    WHEN 'churn_risk' THEN 'winback_outreach'
    WHEN 'vip_silent' THEN 'winback_outreach'
    WHEN 'rfm_vip_at_risk' THEN 'winback_outreach'
    WHEN 'rfm_winback_candidate' THEN 'winback_outreach'
    WHEN 'dead_stock' THEN 'discount_dead_stock'
    WHEN 'dead_stock_signal' THEN 'discount_dead_stock'
    WHEN 'price_optimization' THEN 'price_adjust'
    WHEN 'stockout_critical' THEN 'owner_setup_task'
    WHEN 'low_stock' THEN 'owner_setup_task'
    WHEN 'low_stock_warning' THEN 'owner_setup_task'
    WHEN 'hot_seller_restock' THEN 'owner_setup_task'
    WHEN 'replenish_alert' THEN 'owner_setup_task'
    WHEN 'conversion_drop' THEN 'flag_for_review'
    WHEN 'refund_risk_high' THEN 'flag_for_review'
    WHEN 'cross_sell_opportunity' THEN 'cross_sell_recommend'
    WHEN 'next_best_product' THEN 'cross_sell_recommend'
    WHEN 'review_opportunity' THEN 'request_review'
    WHEN 'csat_request' THEN 'request_review'
    WHEN 'social_proof_hidden_gem' THEN 'request_review'
    WHEN 'ugc_opportunity' THEN 'request_ugc'
    WHEN 'ugc_harvest_opportunity' THEN 'request_ugc'
    WHEN 'ugc_low_volume' THEN 'request_ugc'
    WHEN 'feature_product_opp' THEN 'feature_product'
    WHEN 'trending_product' THEN 'feature_product'
    WHEN 'repeat_purchase_opp' THEN 'repeat_purchase_nudge'
    WHEN 'second_order_gap' THEN 'repeat_purchase_nudge'
    WHEN 'broadcast_suggestion' THEN 'request_review'
    WHEN 'loyalty_tier_proposal' THEN 'owner_review'
    WHEN 'owner_playbook' THEN 'owner_setup_task'
    WHEN 'learning_loop_negative_rules' THEN 'owner_review'
    WHEN 'learning_loop_silent_agents' THEN 'owner_review'
    WHEN 'bundle_opportunity' THEN 'bundle_suggest'
    ELSE
      CASE
        WHEN _insight_type LIKE 'bootstrap\_%' ESCAPE '\' THEN 'owner_setup_task'
        WHEN _insight_type LIKE 'setup\_%' ESCAPE '\' THEN 'owner_setup_task'
        ELSE NULL
      END
  END;
$function$;

-- Schedule daily
SELECT cron.unschedule('detect-trending-products-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname='detect-trending-products-daily'
);
SELECT cron.schedule(
  'detect-trending-products-daily',
  '25 4 * * *',
  $cron$ SELECT public.detect_trending_products(); $cron$
);