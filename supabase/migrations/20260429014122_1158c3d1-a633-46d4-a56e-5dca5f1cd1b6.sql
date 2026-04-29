
CREATE OR REPLACE FUNCTION public.generate_data_driven_insights(_tenant_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_step int := 0;
  v_today text := to_char(now(), 'YYYY-MM-DD');
BEGIN
  -- 1. Stocked-out products
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
  GET DIAGNOSTICS v_step = ROW_COUNT;
  v_count := v_count + v_step;

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
  WHERE pm.tenant_id = _tenant_id AND pm.is_stocked_out = false AND pm.current_stock <= 5 AND pm.current_stock > 0
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id=_tenant_id
        AND ai.dedup_bucket = ('x' || substr(md5('low_stock_warning:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
    );
  GET DIAGNOSTICS v_step = ROW_COUNT;
  v_count := v_count + v_step;

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
  GET DIAGNOSTICS v_step = ROW_COUNT;
  v_count := v_count + v_step;

  -- 4. VIP silent
  INSERT INTO ai_insights (
    tenant_id, insight_type, affected_layer, title, description,
    expected_impact, confidence, risk_level, status, metrics, dedup_bucket
  )
  SELECT
    _tenant_id, 'vip_silent', 'lifecycle',
    'VIP-клієнт мовчить ' || cm.days_since_last || ' днів',
    'Високоцінний клієнт давно не повертався. Запропонуйте персональну пропозицію.',
    'AOV ' || (cm.avg_order_cents/100)::text || ' ₴, не повернувся ' || cm.days_since_last || ' днів',
    0.90, 'high', 'new',
    jsonb_build_object('customer_id', cm.customer_id, 'days_since_last', cm.days_since_last, 'lifecycle_stage', cm.lifecycle_stage),
    ('x' || substr(md5('vip_silent:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM customer_metrics_30d cm
  WHERE cm.tenant_id = _tenant_id AND cm.lifecycle_stage = 'vip' AND cm.days_since_last > 30
    AND NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id=_tenant_id
        AND ai.dedup_bucket = ('x' || substr(md5('vip_silent:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
    );
  GET DIAGNOSTICS v_step = ROW_COUNT;
  v_count := v_count + v_step;

  RETURN v_count;
END;
$$;

SELECT public.generate_insights_for_all_tenants();
