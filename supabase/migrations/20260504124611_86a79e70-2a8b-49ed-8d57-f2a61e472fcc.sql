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
  v_status text := 'healthy';
BEGIN
  SELECT max(created_at) INTO v_last_insight FROM ai_insights;
  SELECT max(created_at) INTO v_last_decision FROM decision_queue;
  SELECT max(measured_at) INTO v_last_outcome FROM action_outcomes;

  -- Count "fresh" insights with status='new' that haven't been picked up by converter
  SELECT count(*) INTO v_pending_insights
    FROM ai_insights WHERE status = 'new' AND created_at < now() - interval '2 hours';

  -- Count auto-approvable pending decisions older than max_age_hours (which means auto-approval missed them)
  SELECT count(*) INTO v_stale_pending_decisions
    FROM decision_queue dq
    JOIN auto_approval_policy p ON p.action_type = dq.action_type AND p.enabled = true
   WHERE dq.status = 'pending'
     AND COALESCE((dq.payload->>'requires_owner')::bool, false) = false
     AND dq.created_at < now() - (p.max_age_hours || ' hours')::interval
     AND dq.created_at > now() - interval '7 days';

  IF v_last_insight IS NULL OR v_last_insight < now() - interval '6 hours' THEN
    v_issues := v_issues || jsonb_build_object('issue', 'no_recent_insights', 'last_at', v_last_insight);
    v_status := 'failing';
  END IF;

  IF v_pending_insights > 5 THEN
    v_issues := v_issues || jsonb_build_object('issue', 'converter_stuck', 'pending', v_pending_insights);
    v_status := 'failing';
  END IF;

  IF v_last_decision IS NOT NULL AND v_last_decision < now() - interval '24 hours' AND v_last_insight > now() - interval '6 hours' THEN
    v_issues := v_issues || jsonb_build_object('issue', 'decision_queue_stale', 'last_at', v_last_decision);
    v_status := COALESCE(NULLIF(v_status,'healthy'),'degraded');
  END IF;

  IF v_stale_pending_decisions > 5 THEN
    v_issues := v_issues || jsonb_build_object('issue', 'auto_approval_missed', 'count', v_stale_pending_decisions);
    v_status := COALESCE(NULLIF(v_status,'healthy'),'degraded');
  END IF;

  IF v_last_outcome IS NULL OR v_last_outcome < now() - interval '12 hours' THEN
    v_issues := v_issues || jsonb_build_object('issue', 'no_recent_outcomes', 'last_at', v_last_outcome);
    v_status := COALESCE(NULLIF(v_status,'healthy'),'degraded');
  END IF;

  -- UPSERT into agent_health (tenant_id NULL = global pipeline)
  INSERT INTO agent_health(agent_id, tenant_id, status, success_rate_24h, error_rate_24h, last_run_at, metadata, updated_at)
  VALUES (
    'sql_pipeline', NULL, v_status,
    CASE WHEN v_status='healthy' THEN 1.0 WHEN v_status='degraded' THEN 0.5 ELSE 0.0 END,
    CASE WHEN v_status='healthy' THEN 0.0 WHEN v_status='degraded' THEN 0.5 ELSE 1.0 END,
    now(),
    jsonb_build_object('issues', v_issues, 'last_insight', v_last_insight, 'last_decision', v_last_decision, 'last_outcome', v_last_outcome, 'pending_insights', v_pending_insights, 'stale_pending', v_stale_pending_decisions),
    now()
  )
  ON CONFLICT (agent_id) WHERE tenant_id IS NULL
  DO UPDATE SET status=EXCLUDED.status, success_rate_24h=EXCLUDED.success_rate_24h, error_rate_24h=EXCLUDED.error_rate_24h, last_run_at=EXCLUDED.last_run_at, metadata=EXCLUDED.metadata, updated_at=now();

  RETURN jsonb_build_object('status', v_status, 'issues', v_issues);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_pipeline_health() TO service_role, postgres;

-- Schedule it hourly
SELECT cron.schedule(
  'pipeline-health-check-hourly',
  '37 * * * *',
  $cron$ SELECT public.check_pipeline_health(); $cron$
);
