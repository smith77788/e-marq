
CREATE OR REPLACE FUNCTION public.detect_action_quality_drops()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH stats AS (
    SELECT
      ao.tenant_id,
      ao.action_type,
      COUNT(*) AS attempts,
      COUNT(*) FILTER (WHERE ao.success) AS wins,
      ROUND(COUNT(*) FILTER (WHERE ao.success)::numeric / COUNT(*), 4) AS win_rate
    FROM action_outcomes ao
    JOIN tenants t ON t.id = ao.tenant_id
    WHERE ao.measured_at > now() - interval '14 days'
      AND COALESCE(t.is_pilot, false) = false
    GROUP BY ao.tenant_id, ao.action_type
    HAVING COUNT(*) >= 8
       AND ROUND(COUNT(*) FILTER (WHERE ao.success)::numeric / COUNT(*), 4) < 0.30
  ),
  inserted AS (
    INSERT INTO ai_insights (
      tenant_id, insight_type, affected_layer, title, description, confidence,
      risk_level, status, metrics, dedup_bucket
    )
    SELECT
      s.tenant_id,
      'action_quality_drop',
      'meta',
      'Падіння якості автономії: ' || s.action_type,
      'За 14 днів ' || s.action_type || ' дав win-rate ' || ROUND(s.win_rate*100)::text
        || '% (' || s.wins || '/' || s.attempts || '). Пора переглянути правила або поставити на паузу.',
      LEAST(0.95, 0.6 + (0.3 - s.win_rate) * 1.2),
      'high',
      'pending',
      jsonb_build_object(
        'action', 'owner_review_rules',
        'action_type', s.action_type,
        'attempts', s.attempts,
        'wins', s.wins,
        'win_rate', s.win_rate,
        'window_days', 14
      ),
      ('x' || substr(md5('action_quality_drop:' || s.tenant_id::text || ':' || s.action_type || ':' || to_char(now(),'IYYY-IW')), 1, 16))::bit(64)::bigint
    FROM stats s
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id = s.tenant_id
        AND ai.insight_type = 'action_quality_drop'
        AND (ai.metrics->>'action_type') = s.action_type
        AND ai.created_at > now() - interval '7 days'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

-- Map insight → action (owner_review_rules is manual-only)
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
    WHEN 'action_quality_drop' THEN 'owner_review_rules'
    WHEN 'replenish_alert' THEN 'replenish_alert'
    ELSE 'owner_review'
  END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('detect-action-quality-drops-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('detect-action-quality-drops-daily', '15 6 * * *', $$ SELECT public.detect_action_quality_drops(); $$);
