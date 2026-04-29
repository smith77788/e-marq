
CREATE OR REPLACE VIEW public.acos_loop_activity AS
WITH events AS (
  -- 1. Insight created
  SELECT
    ai.tenant_id,
    'insight_created'::text AS event_type,
    ai.created_at AS event_at,
    ai.title,
    ai.insight_type AS subtype,
    ai.affected_layer AS layer,
    ai.risk_level,
    ai.id AS ref_id,
    ai.description AS detail
  FROM ai_insights ai

  UNION ALL

  -- 2. Decision proposed
  SELECT
    dq.tenant_id,
    'decision_proposed'::text,
    dq.created_at,
    dq.title,
    dq.action_type,
    NULL::text,
    NULL::text,
    dq.id,
    dq.rationale
  FROM decision_queue dq

  UNION ALL

  -- 3. Decision approved
  SELECT
    dq.tenant_id,
    'decision_approved'::text,
    dq.approved_at,
    dq.title,
    dq.action_type,
    NULL::text,
    NULL::text,
    dq.id,
    'Approved by ' || COALESCE(dq.approved_by::text, 'auto')
  FROM decision_queue dq
  WHERE dq.approved_at IS NOT NULL

  UNION ALL

  -- 4. Decision executed (status='done')
  SELECT
    dq.tenant_id,
    'decision_executed'::text,
    dq.executed_at,
    dq.title,
    dq.action_type,
    NULL::text,
    NULL::text,
    dq.id,
    'Виконано'
  FROM decision_queue dq
  WHERE dq.executed_at IS NOT NULL AND dq.status IN ('done','executing')

  UNION ALL

  -- 5. Outcome measured
  SELECT
    ao.tenant_id,
    CASE WHEN ao.success THEN 'outcome_success' ELSE 'outcome_neutral' END,
    ao.measured_at,
    ao.action_type || ' → ' ||
      CASE
        WHEN ao.attributed_revenue_cents > 0 THEN '+' || (ao.attributed_revenue_cents/100)::text || ' ₴'
        WHEN ao.success IS NULL THEN '(вимірювання...)'
        ELSE 'нейтрально'
      END,
    ao.action_type,
    NULL::text,
    NULL::text,
    ao.id,
    'window: ' || COALESCE(ao.measurement_window, '7d')
  FROM action_outcomes ao
  WHERE ao.measured_at IS NOT NULL
)
SELECT * FROM events
ORDER BY event_at DESC NULLS LAST;

GRANT SELECT ON public.acos_loop_activity TO authenticated;
