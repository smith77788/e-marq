
CREATE OR REPLACE FUNCTION public.score_order_refund_risk(_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_email text;
  v_payment text;
  v_total int;
  v_created timestamptz;
  v_prior_orders int := 0;
  v_prior_bad int := 0;
  v_avg_prior_total numeric := 0;
  v_score numeric := 0;
BEGIN
  SELECT tenant_id, customer_email, payment_method, total_cents, created_at
    INTO v_tenant, v_email, v_payment, v_total, v_created
    FROM orders WHERE id = _order_id;

  IF v_email IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('cancelled','refunded')),
         COALESCE(AVG(NULLIF(total_cents,0))::numeric, 0)
    INTO v_prior_orders, v_prior_bad, v_avg_prior_total
    FROM orders
    WHERE tenant_id = v_tenant
      AND customer_email = v_email
      AND created_at < v_created;

  -- 1. Historical cancel/refund rate (max +0.45)
  IF v_prior_orders > 0 THEN
    v_score := v_score + LEAST(0.45, (v_prior_bad::numeric / v_prior_orders) * 0.6);
  END IF;

  -- 2. Payment method risk (manual / COD-like) (+0.15)
  IF v_payment IS NULL OR LOWER(v_payment) IN ('manual','cod','cash_on_delivery','invoice') THEN
    v_score := v_score + 0.15;
  END IF;

  -- 3. High-AOV outlier vs customer history (>3x avg, +0.20)
  IF v_prior_orders >= 2 AND v_avg_prior_total > 0 AND v_total > v_avg_prior_total * 3 THEN
    v_score := v_score + 0.20;
  END IF;

  -- 4. First-time customer + high ticket (>2x tenant median, +0.20)
  IF v_prior_orders = 0 THEN
    DECLARE
      v_tenant_median numeric;
    BEGIN
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total_cents)
        INTO v_tenant_median
        FROM orders
        WHERE tenant_id = v_tenant
          AND status IN ('paid','fulfilled')
          AND created_at > v_created - interval '90 days';
      IF v_tenant_median IS NOT NULL AND v_total > v_tenant_median * 2 THEN
        v_score := v_score + 0.20;
      END IF;
    END;
  END IF;

  RETURN LEAST(0.99, v_score)::numeric(5,4);
END;
$$;

-- ============================================================
-- Detector
-- ============================================================
CREATE OR REPLACE FUNCTION public.detect_refund_risk_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH cand AS (
    SELECT
      o.id AS order_id,
      o.tenant_id,
      o.customer_email,
      o.customer_name,
      o.total_cents,
      o.payment_method,
      public.score_order_refund_risk(o.id) AS risk_score
    FROM orders o
    JOIN tenants t ON t.id = o.tenant_id
    WHERE o.status = 'paid'
      AND o.fulfilled_at IS NULL
      AND o.created_at > now() - interval '48 hours'
      AND COALESCE(t.is_pilot, false) = false
  ),
  hi AS (
    SELECT * FROM cand WHERE risk_score >= 0.6
  ),
  inserted AS (
    INSERT INTO ai_insights (
      tenant_id, insight_type, affected_layer, title, description, confidence,
      risk_level, status, metrics, dedup_bucket
    )
    SELECT
      h.tenant_id,
      'refund_risk_high',
      'order',
      'Підозріле замовлення: ' || COALESCE(h.customer_name, h.customer_email, 'клієнт')
        || ' (' || ROUND(h.total_cents/100.0)::text || ' UAH)',
      'Risk score ' || ROUND(h.risk_score*100)::text || '%. Перевір вручну до fulfillment: '
        || 'оплата=' || COALESCE(h.payment_method,'unknown') || '.',
      h.risk_score,
      CASE WHEN h.risk_score >= 0.8 THEN 'high' ELSE 'medium' END,
      'pending',
      jsonb_build_object(
        'action', 'flag_for_review',
        'order_id', h.order_id,
        'risk_score', h.risk_score,
        'customer_email', h.customer_email,
        'total_cents', h.total_cents,
        'payment_method', h.payment_method
      ),
      ('x' || substr(md5('refund_risk_high:' || h.order_id::text), 1, 16))::bit(64)::bigint
    FROM hi h
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.insight_type = 'refund_risk_high'
        AND (ai.metrics->>'order_id') = h.order_id::text
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

-- Map insight → action
CREATE OR REPLACE FUNCTION public._map_insight_to_action(_insight_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _insight_type
    WHEN 'stockout_imminent' THEN 'replenish_alert'
    WHEN 'low_stock' THEN 'replenish_alert'
    WHEN 'dead_stock' THEN 'discount_dead_stock'
    WHEN 'vip_silent' THEN 'priority_winback'
    WHEN 'rfm_vip_at_risk' THEN 'priority_winback'
    WHEN 'rfm_winback_candidate' THEN 'winback_campaign'
    WHEN 'bundle_opportunity' THEN 'create_bundle'
    WHEN 'trending_product' THEN 'feature_product'
    WHEN 'high_ltv_at_risk' THEN 'priority_winback'
    WHEN 'refund_risk_high' THEN 'flag_for_review'
    WHEN 'replenish_alert' THEN 'replenish_alert'
    ELSE 'owner_review'
  END;
$$;

-- Schedule
DO $$ BEGIN PERFORM cron.unschedule('detect-refund-risk-15min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('detect-refund-risk-15min', '*/15 * * * *', $$ SELECT public.detect_refund_risk_orders(); $$);
