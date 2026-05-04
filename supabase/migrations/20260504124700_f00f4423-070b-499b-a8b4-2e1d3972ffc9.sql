-- Add metadata column to agent_health if missing
ALTER TABLE public.agent_health ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.check_pipeline_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_insight timestamptz;
  v_last_decision timestamptz;
  v_last_outcome timestamptz;
  v_pending_insights int;
  v_stale_pending_decisions int;
  v_issues jsonb := '[]'::jsonb;
  v_score numeric := 1.0;
BEGIN
  SELECT max(created_at) INTO v_last_insight FROM ai_insights;
  SELECT max(created_at) INTO v_last_decision FROM decision_queue;
  SELECT max(measured_at) INTO v_last_outcome FROM action_outcomes;

  SELECT count(*) INTO v_pending_insights
    FROM ai_insights WHERE status = 'new' AND created_at < now() - interval '2 hours';

  SELECT count(*) INTO v_stale_pending_decisions
    FROM decision_queue dq
    JOIN auto_approval_policy p ON p.action_type = dq.action_type AND p.enabled = true
   WHERE dq.status = 'pending'
     AND COALESCE((dq.payload->>'requires_owner')::bool, false) = false
     AND dq.created_at < now() - (p.max_age_hours || ' hours')::interval
     AND dq.created_at > now() - interval '7 days';

  IF v_last_insight IS NULL OR v_last_insight < now() - interval '6 hours' THEN
    v_issues := v_issues || jsonb_build_object('issue', 'no_recent_insights', 'last_at', v_last_insight);
    v_score := 0.0;
  END IF;

  IF v_pending_insights > 5 THEN
    v_issues := v_issues || jsonb_build_object('issue', 'converter_stuck', 'pending', v_pending_insights);
    v_score := LEAST(v_score, 0.0);
  END IF;

  IF v_last_decision IS NOT NULL AND v_last_decision < now() - interval '24 hours' AND v_last_insight > now() - interval '6 hours' AND v_pending_insights > 0 THEN
    v_issues := v_issues || jsonb_build_object('issue', 'decision_queue_stale', 'last_at', v_last_decision);
    v_score := LEAST(v_score, 0.5);
  END IF;

  IF v_stale_pending_decisions > 5 THEN
    v_issues := v_issues || jsonb_build_object('issue', 'auto_approval_missed', 'count', v_stale_pending_decisions);
    v_score := LEAST(v_score, 0.5);
  END IF;

  IF v_last_outcome IS NULL OR v_last_outcome < now() - interval '48 hours' THEN
    v_issues := v_issues || jsonb_build_object('issue', 'no_recent_outcomes', 'last_at', v_last_outcome);
    v_score := LEAST(v_score, 0.5);
  END IF;

  -- UPSERT into agent_health (one record per day per agent per tenant)
  INSERT INTO agent_health(agent_id, tenant_id, measured_on, runs_total, runs_failed, health_score, metadata, created_at)
  VALUES (
    'sql_pipeline', NULL, current_date, 1,
    CASE WHEN v_score < 1.0 THEN 1 ELSE 0 END,
    v_score,
    jsonb_build_object(
      'issues', v_issues,
      'last_insight', v_last_insight,
      'last_decision', v_last_decision,
      'last_outcome', v_last_outcome,
      'pending_insights', v_pending_insights,
      'stale_pending', v_stale_pending_decisions,
      'checked_at', now()
    ),
    now()
  )
  ON CONFLICT ON CONSTRAINT agent_health_global_uniq
  DO UPDATE SET
    runs_total = agent_health.runs_total + 1,
    runs_failed = agent_health.runs_failed + CASE WHEN EXCLUDED.health_score < 1.0 THEN 1 ELSE 0 END,
    health_score = EXCLUDED.health_score,
    metadata = EXCLUDED.metadata;

  RETURN jsonb_build_object('score', v_score, 'issues', v_issues, 'pending_insights', v_pending_insights, 'stale_pending', v_stale_pending_decisions);
END;
$$;
