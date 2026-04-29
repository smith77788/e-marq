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
  v_data_age_days int;
  v_vip_silent_threshold int;
BEGIN
  SELECT GREATEST(1, EXTRACT(DAY FROM now() - MIN(created_at))::int) INTO v_data_age_days
  FROM orders WHERE tenant_id = _tenant_id;
  v_data_age_days := COALESCE(v_data_age_days, 0);
  v_vip_silent_threshold := CASE WHEN v_data_age_days < 30 THEN 7 ELSE 30 END;

  -- 1. Stockout
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'stockout_critical', 'inventory',
    'Товар без залишку: ' || COALESCE(p.name, pm.product_id::text),
    'Продукт у каталозі, запас вичерпано.', 'Втрачено ~' || (pm.revenue_cents/14/100) || ' ₴/день',
    0.95, 'high', 'new', jsonb_build_object('product_id', pm.product_id, 'units_sold_14d', pm.units_sold),
    ('x' || substr(md5('stockout_critical:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.is_stocked_out = true AND pm.units_sold > 0
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('stockout_critical:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 2. Low stock
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'low_stock_warning', 'inventory',
    'Низький залишок: ' || COALESCE(p.name, pm.product_id::text),
    'Залишок ' || pm.current_stock || ' од.', 'Запасу на ~' || ROUND((pm.current_stock::numeric*14.0/pm.units_sold),1) || ' днів',
    0.85, 'medium', 'new', jsonb_build_object('product_id', pm.product_id, 'current_stock', pm.current_stock, 'units_sold_14d', pm.units_sold),
    ('x' || substr(md5('low_stock_warning:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.is_stocked_out = false AND pm.current_stock <= 10 AND pm.current_stock > 0 AND pm.units_sold > 0
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('low_stock_warning:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 3. Dead stock
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'dead_stock_signal', 'merchandising',
    'Мертвий стік: ' || COALESCE(p.name, pm.product_id::text),
    'Переглядів ' || pm.views || ', продажів 0.', 'Conversion 0%',
    0.80, 'medium', 'new', jsonb_build_object('product_id', pm.product_id, 'views', pm.views),
    ('x' || substr(md5('dead_stock_signal:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.units_sold = 0 AND pm.views > 30
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('dead_stock_signal:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 4. VIP silent
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'vip_silent', 'lifecycle',
    'VIP мовчить ' || cm.days_since_last || ' днів',
    'Клієнт ' || COALESCE(c.name, c.email, cm.customer_id::text) || ' не повертається.',
    'Потенціал ~' || (cm.avg_order_cents/100) || ' ₴',
    0.78, 'medium', 'new', jsonb_build_object('customer_id', cm.customer_id, 'days_since_last', cm.days_since_last, 'avg_order_cents', cm.avg_order_cents),
    ('x' || substr(md5('vip_silent:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM customer_metrics_30d cm LEFT JOIN customers c ON c.id = cm.customer_id
  WHERE cm.tenant_id = _tenant_id AND cm.days_since_last >= v_vip_silent_threshold AND cm.avg_order_cents >= 30000
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('vip_silent:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 5. Hot seller restock
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'hot_seller_restock', 'inventory',
    'Бестселер закінчується: ' || COALESCE(p.name, pm.product_id::text),
    'Продано ' || pm.units_sold || ', залишок ' || pm.current_stock || '.',
    'Закінчиться через ~' || ROUND((pm.current_stock::numeric*14.0/pm.units_sold),1) || ' днів',
    0.90, 'high', 'new', jsonb_build_object('product_id', pm.product_id, 'current_stock', pm.current_stock, 'units_sold_14d', pm.units_sold),
    ('x' || substr(md5('hot_seller_restock:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.units_sold >= 5 AND pm.current_stock > 0
    AND (pm.current_stock::numeric / pm.units_sold * 14.0) <= 14
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('hot_seller_restock:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 6. Conversion drop
  WITH cur AS (SELECT COALESCE(SUM(paid_orders),0)::int paid, COALESCE(SUM(visits),0)::int visits, COALESCE(SUM(revenue_cents),0)::bigint rev FROM funnel_metrics_14d WHERE tenant_id=_tenant_id AND day>=current_date-7 AND day<current_date),
  prev AS (SELECT COALESCE(SUM(paid_orders),0)::int paid, COALESCE(SUM(visits),0)::int visits, COALESCE(SUM(revenue_cents),0)::bigint rev FROM funnel_metrics_14d WHERE tenant_id=_tenant_id AND day>=current_date-14 AND day<current_date-7),
  guarded AS (SELECT cur.paid cpaid, cur.visits cvis, cur.rev crev, prev.paid ppaid, prev.visits pvis, prev.rev prevrev FROM cur, prev WHERE prev.paid >= 5 AND (cur.paid::numeric / prev.paid) <= 0.6 AND ((prev.visits >= 50 AND (cur.visits::numeric / prev.visits) >= 0.7) OR (prev.visits = 0 AND cur.visits = 0)))
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'conversion_drop', 'funnel',
    'Оплати впали на ' || ROUND((1 - g.cpaid::numeric/g.ppaid)*100) || '%',
    g.cpaid || ' за тиждень vs ' || g.ppaid || ' попередньо.',
    '~' || ((g.prevrev - g.crev)/100) || ' ₴ втрат/тиждень',
    0.82, 'high', 'new', jsonb_build_object('paid_now', g.cpaid, 'paid_prev', g.ppaid),
    ('x' || substr(md5('conversion_drop:' || _tenant_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM guarded g
  WHERE NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('conversion_drop:' || _tenant_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 7. Repeat purchase opp
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'repeat_purchase_opp', 'lifecycle',
    'Час нагадати про повторну покупку',
    'Клієнт ' || COALESCE(c.name, c.email, cm.customer_id::text) || ' зробив 1 замовлення ' || cm.days_since_last || ' днів тому.',
    'AOV ~' || (cm.avg_order_cents/100) || ' ₴',
    0.75, 'low', 'new', jsonb_build_object('customer_id', cm.customer_id, 'days_since_last', cm.days_since_last, 'avg_order_cents', cm.avg_order_cents),
    ('x' || substr(md5('repeat_purchase_opp:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM customer_metrics_30d cm LEFT JOIN customers c ON c.id = cm.customer_id
  WHERE cm.tenant_id = _tenant_id AND cm.orders_30d = 1 AND cm.days_since_last BETWEEN 5 AND 20
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('repeat_purchase_opp:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 8. Feature product opp
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'feature_product_opp', 'merchandising',
    'Виставити бестселер: ' || COALESCE(p.name, pm.product_id::text),
    'Топ за продажами (' || pm.units_sold || ' од./14д). Запас ' || pm.current_stock || '.',
    'Підняти видимість → +AOV/CR',
    0.82, 'low', 'new', jsonb_build_object('product_id', pm.product_id, 'units_sold_14d', pm.units_sold, 'revenue_14d', pm.revenue_cents),
    ('x' || substr(md5('feature_product_opp:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM (
    SELECT * FROM product_metrics_14d
    WHERE tenant_id = _tenant_id AND units_sold >= 5 AND current_stock >= 20
    ORDER BY units_sold DESC LIMIT 3
  ) pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('feature_product_opp:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 9. Cross-sell
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'cross_sell_opportunity', 'merchandising',
    'Крос-сейл: ' || COALESCE(p1.name, pair.a::text) || ' + ' || COALESCE(p2.name, pair.b::text),
    'Купують разом у ' || pair.cnt || ' замовленнях за 14 днів.',
    'Привʼязати рекомендацію — +AOV',
    0.78, 'low', 'new', jsonb_build_object('product_a', pair.a, 'product_b', pair.b, 'co_orders_14d', pair.cnt),
    ('x' || substr(md5('cross_sell_opportunity:' || pair.a::text || ':' || pair.b::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM (
    SELECT LEAST(oi1.product_id, oi2.product_id) a, GREATEST(oi1.product_id, oi2.product_id) b, COUNT(DISTINCT oi1.order_id) cnt
    FROM order_items oi1
    JOIN order_items oi2 ON oi1.order_id = oi2.order_id AND oi1.product_id < oi2.product_id
    JOIN orders o ON o.id = oi1.order_id
    WHERE o.tenant_id = _tenant_id AND o.created_at > now() - interval '14 days' AND o.status IN ('paid','fulfilled')
    GROUP BY 1,2 HAVING COUNT(DISTINCT oi1.order_id) >= 2
    ORDER BY cnt DESC LIMIT 5
  ) pair
  LEFT JOIN products p1 ON p1.id = pair.a
  LEFT JOIN products p2 ON p2.id = pair.b
  WHERE NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('cross_sell_opportunity:' || pair.a::text || ':' || pair.b::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 10. Review opportunity — orders.customer_email → customers
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'review_opportunity', 'lifecycle',
    'Запросити відгук',
    'Клієнт ' || COALESCE(c.name, o.customer_name, o.customer_email) || ' отримав замовлення ' || EXTRACT(DAY FROM now() - o.created_at)::int || ' днів тому.',
    'UGC / соціальний доказ',
    0.72, 'low', 'new',
    jsonb_build_object('customer_email', o.customer_email, 'customer_id', c.id, 'order_id', o.id, 'days_since_order', EXTRACT(DAY FROM now() - o.created_at)::int),
    ('x' || substr(md5('review_opportunity:' || o.id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM orders o LEFT JOIN customers c ON c.tenant_id = o.tenant_id AND lower(c.email) = lower(o.customer_email)
  WHERE o.tenant_id = _tenant_id
    AND o.status IN ('paid','fulfilled')
    AND o.customer_email IS NOT NULL
    AND o.created_at BETWEEN now() - interval '21 days' AND now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('review_opportunity:' || o.id::text || ':' || v_today), 1, 15))::bit(60)::bigint)
  LIMIT 20;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  RETURN v_count;
END;
$function$;

SELECT generate_data_driven_insights('abec86dc-dfa9-4cde-adc3-c813b7ec455f') AS new_insights;
SELECT run_sql_loop_tick() AS tick;