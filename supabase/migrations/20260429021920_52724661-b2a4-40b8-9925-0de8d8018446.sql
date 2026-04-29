-- 1) Розширити mapper: додати hot_seller_restock, conversion_drop, та fix legacy типів
CREATE OR REPLACE FUNCTION public._map_insight_to_action(_insight_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _insight_type
    WHEN 'churn_risk'              THEN 'winback_outreach'
    WHEN 'vip_silent'              THEN 'winback_outreach'
    WHEN 'dead_stock'              THEN 'discount_dead_stock'
    WHEN 'dead_stock_signal'       THEN 'discount_dead_stock'
    WHEN 'price_optimization'      THEN 'price_adjust'
    WHEN 'stockout_critical'       THEN 'owner_setup_task'
    WHEN 'low_stock'               THEN 'owner_setup_task'
    WHEN 'low_stock_warning'       THEN 'owner_setup_task'
    WHEN 'hot_seller_restock'      THEN 'owner_setup_task'
    WHEN 'conversion_drop'         THEN 'flag_for_review'
    WHEN 'refund_risk_high'        THEN 'flag_for_review'
    WHEN 'cross_sell_opportunity'  THEN 'cross_sell_recommend'
    WHEN 'review_opportunity'      THEN 'request_review'
    WHEN 'ugc_opportunity'         THEN 'request_ugc'
    WHEN 'feature_product_opp'     THEN 'feature_product'
    WHEN 'repeat_purchase_opp'     THEN 'repeat_purchase_nudge'
    ELSE
      CASE
        WHEN _insight_type LIKE 'bootstrap\_%' ESCAPE '\' THEN 'owner_setup_task'
        WHEN _insight_type LIKE 'setup\_%'     ESCAPE '\' THEN 'owner_setup_task'
        ELSE NULL
      END
  END;
$function$;

-- 2) Розширити insight generator: додати hot_seller_restock + conversion_drop
CREATE OR REPLACE FUNCTION public.generate_data_driven_insights(_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_step int := 0;
  v_today text := to_char(now(), 'YYYY-MM-DD');
BEGIN
  -- 1. Stockout
  INSERT INTO ai_insights (
    tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket
  )
  SELECT
    _tenant_id, 'stockout_critical', 'inventory',
    'Товар без залишку: ' || COALESCE(p.name, pm.product_id::text),
    'Продукт виставлено в каталог, але запас вичерпано. Втрачаєте продажі.',
    'Втрачено ~' || COALESCE((pm.revenue_cents / 14 / 100)::text, '0') || ' ₴/день',
    0.95, 'high', 'new',
    jsonb_build_object('product_id', pm.product_id, 'units_sold_14d', pm.units_sold, 'revenue_14d', pm.revenue_cents),
    ('x' || substr(md5('stockout_critical:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm
  LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.is_stocked_out = true
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id=_tenant_id
        AND ai.dedup_bucket = ('x' || substr(md5('stockout_critical:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
    );
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 2. Low stock
  INSERT INTO ai_insights (
    tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket
  )
  SELECT
    _tenant_id, 'low_stock_warning', 'inventory',
    'Низький залишок: ' || COALESCE(p.name, pm.product_id::text),
    'Залишок ' || pm.current_stock || ' одиниць. Замовте поповнення.',
    CASE WHEN pm.units_sold>0 THEN 'Запасу на ~' || ROUND((pm.current_stock::numeric*14.0/pm.units_sold),1) || ' днів' ELSE 'Слабкий продаж' END,
    0.85, 'medium', 'new',
    jsonb_build_object('product_id', pm.product_id, 'current_stock', pm.current_stock, 'units_sold_14d', pm.units_sold),
    ('x' || substr(md5('low_stock_warning:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm
  LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.is_stocked_out = false AND pm.current_stock <= 10 AND pm.current_stock > 0 AND pm.units_sold > 0
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id=_tenant_id
        AND ai.dedup_bucket = ('x' || substr(md5('low_stock_warning:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
    );
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 3. Dead stock
  INSERT INTO ai_insights (
    tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket
  )
  SELECT
    _tenant_id, 'dead_stock_signal', 'merchandising',
    'Мертвий стік: ' || COALESCE(p.name, pm.product_id::text),
    'Переглянуто ' || pm.views || ' разів за 14 днів — 0 продажів. Перевірте ціну, фото, опис.',
    'Conversion rate = 0% попри ' || pm.views || ' переглядів',
    0.80, 'medium', 'new',
    jsonb_build_object('product_id', pm.product_id, 'views', pm.views),
    ('x' || substr(md5('dead_stock_signal:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm
  LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.units_sold = 0 AND pm.views > 30
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id=_tenant_id
        AND ai.dedup_bucket = ('x' || substr(md5('dead_stock_signal:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
    );
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 4. VIP silent
  INSERT INTO ai_insights (
    tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket
  )
  SELECT
    _tenant_id, 'vip_silent', 'lifecycle',
    'VIP-клієнт мовчить ' || cm.days_since_last || ' днів',
    'Клієнт ' || COALESCE(c.name, c.email, cm.customer_id::text) || ' не повертається. Запустіть winback.',
    'Потенціал ~' || (cm.avg_order_cents/100) || ' ₴',
    0.78, 'medium', 'new',
    jsonb_build_object('customer_id', cm.customer_id, 'days_since_last', cm.days_since_last, 'avg_order_cents', cm.avg_order_cents),
    ('x' || substr(md5('vip_silent:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM customer_metrics_30d cm
  LEFT JOIN customers c ON c.id = cm.customer_id
  WHERE cm.tenant_id = _tenant_id AND cm.days_since_last >= 30 AND cm.avg_order_cents >= 50000
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id=_tenant_id
        AND ai.dedup_bucket = ('x' || substr(md5('vip_silent:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
    );
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 5. Hot seller restock — топ-продукт з падаючим запасом vs швидкістю продажу
  INSERT INTO ai_insights (
    tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket
  )
  SELECT
    _tenant_id, 'hot_seller_restock', 'inventory',
    'Бестселер закінчується: ' || COALESCE(p.name, pm.product_id::text),
    'Продано ' || pm.units_sold || ' од. за 14 днів, залишок ' || pm.current_stock || '. Закінчиться через ~' || ROUND((pm.current_stock::numeric*14.0/NULLIF(pm.units_sold,0)),1) || ' днів.',
    'Втрата ~' || (pm.revenue_cents/14/100) || ' ₴/день при стокауті',
    0.90, 'high', 'new',
    jsonb_build_object('product_id', pm.product_id, 'current_stock', pm.current_stock, 'units_sold_14d', pm.units_sold, 'days_left', ROUND((pm.current_stock::numeric*14.0/NULLIF(pm.units_sold,0)),1)),
    ('x' || substr(md5('hot_seller_restock:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm
  LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id
    AND pm.units_sold >= 5
    AND pm.current_stock > 0
    AND (pm.current_stock::numeric / NULLIF(pm.units_sold,0) * 14.0) <= 7  -- менше 7 днів запасу
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id=_tenant_id
        AND ai.dedup_bucket = ('x' || substr(md5('hot_seller_restock:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
    );
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 6. Conversion drop — funnel: traffic стабільний, paid_orders впав ≥40% vs попередній тиждень
  INSERT INTO ai_insights (
    tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket
  )
  SELECT
    _tenant_id, 'conversion_drop', 'funnel',
    'Конверсія впала на ' || ROUND((1 - cur.paid::numeric/NULLIF(prev.paid,0))*100) || '%',
    'За останні 7 днів оплачених замовлень: ' || cur.paid || ' (попередні 7 днів: ' || prev.paid || '). Трафік: ' || cur.visits || ' vs ' || prev.visits || '.',
    'Потенційна втрата ~' || ((prev.rev - cur.rev)/100) || ' ₴ за тиждень',
    0.82, 'high', 'new',
    jsonb_build_object('paid_now', cur.paid, 'paid_prev', prev.paid, 'visits_now', cur.visits, 'visits_prev', prev.visits, 'revenue_delta_cents', prev.rev - cur.rev),
    ('x' || substr(md5('conversion_drop:' || _tenant_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM (
    SELECT COALESCE(SUM(paid_orders),0) paid, COALESCE(SUM(visits),0) visits, COALESCE(SUM(revenue_cents),0) rev
    FROM funnel_metrics_14d
    WHERE tenant_id = _tenant_id AND day >= current_date - 7 AND day < current_date
  ) cur,
  (
    SELECT COALESCE(SUM(paid_orders),0) paid, COALESCE(SUM(visits),0) visits, COALESCE(SUM(revenue_cents),0) rev
    FROM funnel_metrics_14d
    WHERE tenant_id = _tenant_id AND day >= current_date - 14 AND day < current_date - 7
  ) prev
  WHERE prev.paid >= 5
    AND cur.paid::numeric / NULLIF(prev.paid,0) <= 0.6
    AND cur.visits::numeric / NULLIF(prev.visits,1) >= 0.7  -- трафік не впав сильно
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id=_tenant_id
        AND ai.dedup_bucket = ('x' || substr(md5('conversion_drop:' || _tenant_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
    );
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  RETURN v_count;
END;
$function$;