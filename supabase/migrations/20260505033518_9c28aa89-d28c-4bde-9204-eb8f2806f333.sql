
CREATE OR REPLACE FUNCTION public.detect_high_ltv_at_risk()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH candidates AS (
    SELECT
      l.tenant_id,
      l.customer_id,
      l.predicted_ltv_cents,
      l.churn_probability,
      l.segment,
      c.email,
      c.name
    FROM customer_ltv_scores l
    JOIN customers c ON c.id = l.customer_id
    WHERE l.segment IN ('gold','platinum')
      AND l.churn_probability >= 0.5
      AND c.consent_marketing = true
  ),
  inserted AS (
    INSERT INTO ai_insights (
      tenant_id, insight_type, affected_layer, title, description, confidence,
      risk_level, status, metrics, dedup_bucket
    )
    SELECT
      cd.tenant_id,
      'high_ltv_at_risk',
      'customer',
      'High-LTV клієнт під ризиком: ' || COALESCE(cd.name, cd.email, 'клієнт'),
      'Сегмент ' || cd.segment || ', прогноз LTV ' || ROUND(cd.predicted_ltv_cents/100.0)::text
        || ' UAH, ймовірність відтоку ' || ROUND(cd.churn_probability*100)::text || '%. Рекомендований персональний winback.',
      LEAST(0.9, 0.5 + cd.churn_probability * 0.4),
      CASE WHEN cd.segment = 'platinum' THEN 'high' ELSE 'medium' END,
      'pending',
      jsonb_build_object(
        'action', 'priority_winback',
        'segment', cd.segment,
        'predicted_ltv_cents', cd.predicted_ltv_cents,
        'churn_probability', cd.churn_probability,
        'customer_id', cd.customer_id
      ),
      ('x' || substr(md5('high_ltv_at_risk:' || cd.tenant_id::text || ':' || cd.customer_id::text || ':' || to_char(now(), 'IYYY-IW')), 1, 16))::bit(64)::bigint
    FROM candidates cd
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id = cd.tenant_id
        AND ai.insight_type = 'high_ltv_at_risk'
        AND (ai.metrics->>'customer_id') = cd.customer_id::text
        AND ai.created_at > now() - interval '7 days'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;
