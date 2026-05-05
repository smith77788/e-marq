
CREATE OR REPLACE FUNCTION public.compute_bundle_suggestions(
  _window_days int DEFAULT 90,
  _min_support_pct numeric DEFAULT 3.0,
  _min_lift numeric DEFAULT 1.3,
  _min_co_orders int DEFAULT 5
)
RETURNS TABLE(processed_tenants int, pairs_inserted int, pairs_updated int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _tenants int := 0; _ins int := 0; _upd int := 0;
BEGIN
  WITH paid_orders AS (
    SELECT o.id AS order_id, o.tenant_id
    FROM public.orders o
    WHERE o.status IN ('paid','fulfilled')
      AND o.created_at >= now() - make_interval(days => _window_days)
  ),
  order_products AS (
    SELECT DISTINCT po.tenant_id, po.order_id, oi.product_id,
           (oi.unit_price_cents * oi.quantity)::bigint AS line_revenue
    FROM paid_orders po
    JOIN public.order_items oi ON oi.order_id = po.order_id
    WHERE oi.product_id IS NOT NULL
  ),
  multi_item_orders AS (
    SELECT tenant_id, order_id FROM order_products
    GROUP BY tenant_id, order_id HAVING count(DISTINCT product_id) >= 2
  ),
  totals AS (
    SELECT tenant_id, count(*) AS total_orders
    FROM (SELECT DISTINCT tenant_id, order_id FROM order_products) s GROUP BY tenant_id
  ),
  per_product AS (
    SELECT tenant_id, product_id, count(DISTINCT order_id) AS orders_with
    FROM order_products GROUP BY tenant_id, product_id
  ),
  pairs AS (
    SELECT a.tenant_id,
      LEAST(a.product_id, b.product_id) AS product_a_id,
      GREATEST(a.product_id, b.product_id) AS product_b_id,
      count(DISTINCT a.order_id) AS co_orders,
      avg(a.line_revenue + b.line_revenue) AS avg_combined_revenue
    FROM order_products a
    JOIN order_products b ON b.tenant_id=a.tenant_id AND b.order_id=a.order_id AND b.product_id>a.product_id
    JOIN multi_item_orders m ON m.tenant_id=a.tenant_id AND m.order_id=a.order_id
    GROUP BY a.tenant_id, LEAST(a.product_id,b.product_id), GREATEST(a.product_id,b.product_id)
  ),
  scored AS (
    SELECT p.tenant_id, p.product_a_id, p.product_b_id, p.co_orders,
      pa.orders_with AS orders_a, pb.orders_with AS orders_b, t.total_orders,
      ROUND((p.co_orders::numeric / NULLIF(t.total_orders,0))*100.0, 3) AS support_pct,
      ROUND((p.co_orders::numeric / NULLIF(pa.orders_with,0))*100.0, 3) AS conf_a_to_b,
      ROUND((p.co_orders::numeric * t.total_orders) / NULLIF(pa.orders_with::numeric * pb.orders_with::numeric, 0), 3) AS lift,
      COALESCE(p.avg_combined_revenue,0)::bigint AS avg_combined_rev,
      _window_days AS window_days
    FROM pairs p
    JOIN totals t ON t.tenant_id=p.tenant_id
    JOIN per_product pa ON pa.tenant_id=p.tenant_id AND pa.product_id=p.product_a_id
    JOIN per_product pb ON pb.tenant_id=p.tenant_id AND pb.product_id=p.product_b_id
    JOIN public.products prA ON prA.id=p.product_a_id AND prA.is_active=true
    JOIN public.products prB ON prB.id=p.product_b_id AND prB.is_active=true
  ),
  filtered AS (
    SELECT * FROM scored
    WHERE co_orders >= _min_co_orders AND support_pct >= _min_support_pct AND lift >= _min_lift
  ),
  upserted AS (
    INSERT INTO public.bundle_suggestions (
      tenant_id, product_a_id, product_b_id, co_orders, orders_a, orders_b, total_orders,
      support_pct, confidence_a_to_b_pct, lift, avg_combined_revenue_cents, window_days, last_computed_at
    )
    SELECT tenant_id, product_a_id, product_b_id, co_orders, orders_a, orders_b, total_orders,
           support_pct, conf_a_to_b, lift, avg_combined_rev, window_days, now()
    FROM filtered
    ON CONFLICT (tenant_id, product_a_id, product_b_id) DO UPDATE
    SET co_orders=EXCLUDED.co_orders, orders_a=EXCLUDED.orders_a, orders_b=EXCLUDED.orders_b,
        total_orders=EXCLUDED.total_orders, support_pct=EXCLUDED.support_pct,
        confidence_a_to_b_pct=EXCLUDED.confidence_a_to_b_pct, lift=EXCLUDED.lift,
        avg_combined_revenue_cents=EXCLUDED.avg_combined_revenue_cents,
        window_days=EXCLUDED.window_days, last_computed_at=now()
    RETURNING (xmax=0) AS inserted
  )
  SELECT
    (SELECT count(DISTINCT tenant_id) FROM filtered),
    (SELECT count(*) FROM upserted WHERE inserted),
    (SELECT count(*) FROM upserted WHERE NOT inserted)
  INTO _tenants, _ins, _upd;

  DELETE FROM public.bundle_suggestions WHERE last_computed_at < now() - interval '30 days';
  RETURN QUERY SELECT _tenants, _ins, _upd;
END;
$$;

DO $$
DECLARE r1 record; r2 record;
BEGIN
  SELECT * INTO r1 FROM public.compute_bundle_suggestions();
  SELECT * INTO r2 FROM public.detect_bundle_signals();
  RAISE NOTICE 'compute tenants=% ins=% upd=%, insights_created=%',
    r1.processed_tenants, r1.pairs_inserted, r1.pairs_updated, r2.insights_created;
END $$;
