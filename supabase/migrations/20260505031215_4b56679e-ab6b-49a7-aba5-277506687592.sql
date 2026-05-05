
CREATE TABLE IF NOT EXISTS public.bundle_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_a_id uuid NOT NULL,
  product_b_id uuid NOT NULL,
  co_orders int NOT NULL,
  orders_a int NOT NULL,
  orders_b int NOT NULL,
  total_orders int NOT NULL,
  support_pct numeric(6,3) NOT NULL,
  confidence_a_to_b_pct numeric(6,3) NOT NULL,
  lift numeric(8,3) NOT NULL,
  avg_combined_revenue_cents bigint NOT NULL DEFAULT 0,
  window_days int NOT NULL DEFAULT 90,
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (product_a_id < product_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS bundle_suggestions_pair_uniq
  ON public.bundle_suggestions(tenant_id, product_a_id, product_b_id);
CREATE INDEX IF NOT EXISTS bundle_suggestions_tenant_lift_idx
  ON public.bundle_suggestions(tenant_id, lift DESC);

ALTER TABLE public.bundle_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bundle_suggestions_tenant_read ON public.bundle_suggestions;
CREATE POLICY bundle_suggestions_tenant_read
  ON public.bundle_suggestions FOR SELECT
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS bundle_suggestions_service_all ON public.bundle_suggestions;
CREATE POLICY bundle_suggestions_service_all
  ON public.bundle_suggestions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

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
    WHERE o.status IN ('paid','fulfilled','shipped','delivered','completed')
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
    SELECT tenant_id, order_id
    FROM order_products
    GROUP BY tenant_id, order_id
    HAVING count(DISTINCT product_id) >= 2
  ),
  totals AS (
    SELECT tenant_id, count(*) AS total_orders
    FROM (SELECT DISTINCT tenant_id, order_id FROM order_products) s
    GROUP BY tenant_id
  ),
  per_product AS (
    SELECT tenant_id, product_id, count(DISTINCT order_id) AS orders_with
    FROM order_products GROUP BY tenant_id, product_id
  ),
  pairs AS (
    SELECT
      a.tenant_id,
      LEAST(a.product_id, b.product_id)    AS product_a_id,
      GREATEST(a.product_id, b.product_id) AS product_b_id,
      count(DISTINCT a.order_id)           AS co_orders,
      avg(a.line_revenue + b.line_revenue) AS avg_combined_revenue
    FROM order_products a
    JOIN order_products b
      ON b.tenant_id = a.tenant_id AND b.order_id = a.order_id AND b.product_id > a.product_id
    JOIN multi_item_orders m ON m.tenant_id = a.tenant_id AND m.order_id = a.order_id
    GROUP BY a.tenant_id, LEAST(a.product_id, b.product_id), GREATEST(a.product_id, b.product_id)
  ),
  scored AS (
    SELECT
      p.tenant_id, p.product_a_id, p.product_b_id, p.co_orders,
      pa.orders_with AS orders_a, pb.orders_with AS orders_b, t.total_orders,
      ROUND((p.co_orders::numeric / NULLIF(t.total_orders,0)) * 100.0, 3) AS support_pct,
      ROUND((p.co_orders::numeric / NULLIF(pa.orders_with,0)) * 100.0, 3) AS conf_a_to_b,
      ROUND((p.co_orders::numeric * t.total_orders) / NULLIF(pa.orders_with::numeric * pb.orders_with::numeric, 0), 3) AS lift,
      COALESCE(p.avg_combined_revenue, 0)::bigint AS avg_combined_rev,
      _window_days AS window_days
    FROM pairs p
    JOIN totals t ON t.tenant_id = p.tenant_id
    JOIN per_product pa ON pa.tenant_id = p.tenant_id AND pa.product_id = p.product_a_id
    JOIN per_product pb ON pb.tenant_id = p.tenant_id AND pb.product_id = p.product_b_id
    JOIN public.products prA ON prA.id = p.product_a_id AND prA.is_active = true
    JOIN public.products prB ON prB.id = p.product_b_id AND prB.is_active = true
  ),
  filtered AS (
    SELECT * FROM scored
    WHERE co_orders >= _min_co_orders AND support_pct >= _min_support_pct AND lift >= _min_lift
  ),
  upserted AS (
    INSERT INTO public.bundle_suggestions (
      tenant_id, product_a_id, product_b_id,
      co_orders, orders_a, orders_b, total_orders,
      support_pct, confidence_a_to_b_pct, lift,
      avg_combined_revenue_cents, window_days, last_computed_at
    )
    SELECT tenant_id, product_a_id, product_b_id, co_orders, orders_a, orders_b, total_orders,
           support_pct, conf_a_to_b, lift, avg_combined_rev, window_days, now()
    FROM filtered
    ON CONFLICT (tenant_id, product_a_id, product_b_id) DO UPDATE
    SET co_orders = EXCLUDED.co_orders,
        orders_a = EXCLUDED.orders_a,
        orders_b = EXCLUDED.orders_b,
        total_orders = EXCLUDED.total_orders,
        support_pct = EXCLUDED.support_pct,
        confidence_a_to_b_pct = EXCLUDED.confidence_a_to_b_pct,
        lift = EXCLUDED.lift,
        avg_combined_revenue_cents = EXCLUDED.avg_combined_revenue_cents,
        window_days = EXCLUDED.window_days,
        last_computed_at = now()
    RETURNING (xmax = 0) AS inserted
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

REVOKE ALL ON FUNCTION public.compute_bundle_suggestions(int, numeric, numeric, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bundle_suggestions(int, numeric, numeric, int) TO service_role;

CREATE OR REPLACE FUNCTION public.detect_bundle_signals(_top_n int DEFAULT 5)
RETURNS TABLE(insights_created int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _created int := 0; _r record; _bucket bigint; _exists boolean;
BEGIN
  FOR _r IN
    WITH ranked AS (
      SELECT bs.*, prA.name AS name_a, prB.name AS name_b,
             row_number() OVER (PARTITION BY bs.tenant_id ORDER BY bs.lift DESC, bs.co_orders DESC) AS rn
      FROM public.bundle_suggestions bs
      JOIN public.products prA ON prA.id = bs.product_a_id
      JOIN public.products prB ON prB.id = bs.product_b_id
      WHERE bs.last_computed_at > now() - interval '2 days'
    )
    SELECT * FROM ranked WHERE rn <= _top_n
  LOOP
    _bucket := ('x'||substr(md5(
      'bundle_opportunity|'||_r.tenant_id::text||'|'||_r.product_a_id::text||'|'||_r.product_b_id::text||'|'||to_char(now(),'IYYY-IW')
    ),1,16))::bit(64)::bigint;

    SELECT EXISTS (
      SELECT 1 FROM public.ai_insights
      WHERE tenant_id = _r.tenant_id AND dedup_bucket = _bucket
        AND created_at > now() - interval '7 days'
    ) INTO _exists;
    IF _exists THEN CONTINUE; END IF;

    INSERT INTO public.ai_insights (
      tenant_id, insight_type, title, description, severity, status,
      payload, dedup_bucket, source, created_at
    ) VALUES (
      _r.tenant_id, 'bundle_opportunity',
      format('Bundle: %s + %s', _r.name_a, _r.name_b),
      format('Купують разом у %s%% замовлень (lift %sx, %s спільних, %s днів). Середній чек комбо: %s коп.',
             _r.support_pct, _r.lift, _r.co_orders, _r.window_days, _r.avg_combined_revenue_cents),
      'info', 'open',
      jsonb_build_object(
        'action','bundle_suggest',
        'product_a_id',_r.product_a_id,'product_b_id',_r.product_b_id,
        'product_a_name',_r.name_a,'product_b_name',_r.name_b,
        'co_orders',_r.co_orders,'support_pct',_r.support_pct,'lift',_r.lift,
        'confidence_a_to_b_pct',_r.confidence_a_to_b_pct,
        'avg_combined_revenue_cents',_r.avg_combined_revenue_cents,
        'window_days',_r.window_days,
        'recommendation','Створити bundle "'||_r.name_a||' + '||_r.name_b||'" зі знижкою 5–10% або показати "Часто купують разом".'
      ),
      _bucket, 'sql_bundle_engine', now()
    );
    _created := _created + 1;
  END LOOP;
  RETURN QUERY SELECT _created;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_bundle_signals(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_bundle_signals(int) TO service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('bundle-suggestions-daily');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'bundle-suggestions-daily',
  '15 4 * * *',
  $cron$
  SELECT public.compute_bundle_suggestions();
  SELECT public.detect_bundle_signals();
  $cron$
);
