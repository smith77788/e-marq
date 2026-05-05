
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
      tenant_id, insight_type, affected_layer, title, description,
      expected_impact, confidence, risk_level, status, metrics, dedup_bucket, created_at
    ) VALUES (
      _r.tenant_id, 'bundle_opportunity', 'commerce',
      format('Bundle: %s + %s', _r.name_a, _r.name_b),
      format('Купують разом у %s%% замовлень (lift %sx, %s спільних, %s днів). Середній чек комбо: %s коп.',
             _r.support_pct, _r.lift, _r.co_orders, _r.window_days, _r.avg_combined_revenue_cents),
      'medium', LEAST(0.95, 0.5 + _r.lift / 10.0)::numeric, 'low', 'open',
      jsonb_build_object(
        'action','bundle_suggest',
        'product_a_id',_r.product_a_id,'product_b_id',_r.product_b_id,
        'product_a_name',_r.name_a,'product_b_name',_r.name_b,
        'co_orders',_r.co_orders,'support_pct',_r.support_pct,'lift',_r.lift,
        'confidence_a_to_b_pct',_r.confidence_a_to_b_pct,
        'avg_combined_revenue_cents',_r.avg_combined_revenue_cents,
        'window_days',_r.window_days,
        'recommendation','Створити bundle "'||_r.name_a||' + '||_r.name_b||'" зі знижкою 5–10% або показати "Часто купують разом".',
        'source','sql_bundle_engine'
      ),
      _bucket, now()
    );
    _created := _created + 1;
  END LOOP;
  RETURN QUERY SELECT _created;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_bundle_signals(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_bundle_signals(int) TO service_role;

DO $$
DECLARE _e record; _i record;
BEGIN
  SELECT * INTO _e FROM public.compute_bundle_suggestions();
  SELECT * INTO _i FROM public.detect_bundle_signals();
  RAISE NOTICE 'engine: tenants=% ins=% upd=%, insights=%',
    _e.processed_tenants, _e.pairs_inserted, _e.pairs_updated, _i.insights_created;
END $$;
