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
  -- Динамічний поріг для VIP silent: молодий tenant = 7 днів, зрілий = 30
  SELECT GREATEST(1, EXTRACT(DAY FROM now() - MIN(created_at))::int)
    INTO v_data_age_days
  FROM orders WHERE tenant_id = _tenant_id;
  v_data_age_days := COALESCE(v_data_age_days, 0);
  v_vip_silent_threshold := CASE WHEN v_data_age_days < 30 THEN 7 ELSE 30 END;

  -- 1. Stockout
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'stockout_critical', 'inventory',
    'Товар без залишку: ' || COALESCE(p.name, pm.product_id::text),
    'Продукт виставлено в каталог, але запас вичерпано. Втрачаєте продажі.',
    'Втрачено ~' || COALESCE((pm.revenue_cents / 14 / 100)::text, '0') || ' ₴/день',
    0.95, 'high', 'new',
    jsonb_build_object('product_id', pm.product_id, 'units_sold_14d', pm.units_sold, 'revenue_14d', pm.revenue_cents),
    ('x' || substr(md5('stockout_critical:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.is_stocked_out = true AND pm.units_sold > 0
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('stockout_critical:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 2. Low stock
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'low_stock_warning', 'inventory',
    'Низький залишок: ' || COALESCE(p.name, pm.product_id::text),
    'Залишок ' || pm.current_stock || ' одиниць. Замовте поповнення.',
    CASE WHEN pm.units_sold>0 THEN 'Запасу на ~' || ROUND((pm.current_stock::numeric*14.0/pm.units_sold),1) || ' днів' ELSE 'Слабкий продаж' END,
    0.85, 'medium', 'new',
    jsonb_build_object('product_id', pm.product_id, 'current_stock', pm.current_stock, 'units_sold_14d', pm.units_sold),
    ('x' || substr(md5('low_stock_warning:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.is_stocked_out = false AND pm.current_stock <= 10 AND pm.current_stock > 0 AND pm.units_sold > 0
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('low_stock_warning:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 3. Dead stock
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'dead_stock_signal', 'merchandising',
    'Мертвий стік: ' || COALESCE(p.name, pm.product_id::text),
    'Переглянуто ' || pm.views || ' разів за 14 днів — 0 продажів. Перевірте ціну, фото, опис.',
    'Conversion rate = 0% попри ' || pm.views || ' переглядів',
    0.80, 'medium', 'new',
    jsonb_build_object('product_id', pm.product_id, 'views', pm.views),
    ('x' || substr(md5('dead_stock_signal:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.units_sold = 0 AND pm.views > 30
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('dead_stock_signal:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 4. VIP silent з динамічним порогом
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'vip_silent', 'lifecycle',
    'VIP-клієнт мовчить ' || cm.days_since_last || ' днів',
    'Клієнт ' || COALESCE(c.name, c.email, cm.customer_id::text) || ' не повертається. Запустіть winback.',
    'Потенціал ~' || (cm.avg_order_cents/100) || ' ₴',
    0.78, 'medium', 'new',
    jsonb_build_object('customer_id', cm.customer_id, 'days_since_last', cm.days_since_last, 'avg_order_cents', cm.avg_order_cents, 'threshold', v_vip_silent_threshold),
    ('x' || substr(md5('vip_silent:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM customer_metrics_30d cm LEFT JOIN customers c ON c.id = cm.customer_id
  WHERE cm.tenant_id = _tenant_id AND cm.days_since_last >= v_vip_silent_threshold AND cm.avg_order_cents >= 30000
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('vip_silent:' || cm.customer_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 5. Hot seller restock — поріг ≤14 днів
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'hot_seller_restock', 'inventory',
    'Бестселер закінчується: ' || COALESCE(p.name, pm.product_id::text),
    'Продано ' || pm.units_sold || ' од. за 14 днів, залишок ' || pm.current_stock || '. Закінчиться через ~' || ROUND((pm.current_stock::numeric*14.0/pm.units_sold),1) || ' днів.',
    'Втрата ~' || (pm.revenue_cents/14/100) || ' ₴/день при стокауті',
    0.90, 'high', 'new',
    jsonb_build_object('product_id', pm.product_id, 'current_stock', pm.current_stock, 'units_sold_14d', pm.units_sold, 'days_left', ROUND((pm.current_stock::numeric*14.0/pm.units_sold),1)),
    ('x' || substr(md5('hot_seller_restock:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM product_metrics_14d pm LEFT JOIN products p ON p.id = pm.product_id
  WHERE pm.tenant_id = _tenant_id AND pm.units_sold >= 5 AND pm.current_stock > 0
    AND (pm.current_stock::numeric / pm.units_sold * 14.0) <= 14
    AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('hot_seller_restock:' || pm.product_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  -- 6. Conversion drop — visits-aware fallback на orders-only
  WITH cur AS (
    SELECT COALESCE(SUM(paid_orders),0)::int paid, COALESCE(SUM(visits),0)::int visits, COALESCE(SUM(revenue_cents),0)::bigint rev
    FROM funnel_metrics_14d WHERE tenant_id = _tenant_id AND day >= current_date - 7 AND day < current_date
  ),
  prev AS (
    SELECT COALESCE(SUM(paid_orders),0)::int paid, COALESCE(SUM(visits),0)::int visits, COALESCE(SUM(revenue_cents),0)::bigint rev
    FROM funnel_metrics_14d WHERE tenant_id = _tenant_id AND day >= current_date - 14 AND day < current_date - 7
  ),
  guarded AS (
    SELECT cur.paid cpaid, cur.visits cvis, cur.rev crev, prev.paid ppaid, prev.visits pvis, prev.rev prevrev
    FROM cur, prev
    WHERE prev.paid >= 5
      AND (cur.paid::numeric / prev.paid) <= 0.6
      AND (
        -- visits-aware: трафік стабільний АБО visits=0 для обох (нема аналітики)
        (prev.visits >= 50 AND (cur.visits::numeric / prev.visits) >= 0.7)
        OR (prev.visits = 0 AND cur.visits = 0)
      )
  )
  INSERT INTO ai_insights (tenant_id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, dedup_bucket)
  SELECT _tenant_id, 'conversion_drop', 'funnel',
    'Оплачені замовлення впали на ' || ROUND((1 - g.cpaid::numeric/g.ppaid)*100) || '%',
    'За останні 7 днів: ' || g.cpaid || ' оплат (попередні 7 днів: ' || g.ppaid || ').' || CASE WHEN g.pvis>0 THEN ' Трафік: ' || g.cvis || ' vs ' || g.pvis || '.' ELSE ' Аналітика трафіку відсутня.' END,
    'Потенційна втрата ~' || ((g.prevrev - g.crev)/100) || ' ₴ за тиждень',
    0.82, 'high', 'new',
    jsonb_build_object('paid_now', g.cpaid, 'paid_prev', g.ppaid, 'visits_now', g.cvis, 'visits_prev', g.pvis, 'revenue_delta_cents', g.prevrev - g.crev),
    ('x' || substr(md5('conversion_drop:' || _tenant_id::text || ':' || v_today), 1, 15))::bit(60)::bigint
  FROM guarded g
  WHERE NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.tenant_id=_tenant_id AND ai.dedup_bucket = ('x' || substr(md5('conversion_drop:' || _tenant_id::text || ':' || v_today), 1, 15))::bit(60)::bigint);
  GET DIAGNOSTICS v_step = ROW_COUNT; v_count := v_count + v_step;

  RETURN v_count;
END;
$function$;

-- Запуск негайно для пілота
SELECT generate_data_driven_insights('abec86dc-dfa9-4cde-adc3-c813b7ec455f') AS new_insights;
SELECT run_sql_loop_tick() AS tick_result;