CREATE OR REPLACE FUNCTION public.dispatch_high_impact_decisions(_tenant_id uuid)
RETURNS TABLE(decision_id uuid, action_id uuid, agent_id text, action_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_action_id uuid;
  v_agent text;
BEGIN
  FOR rec IN
    SELECT dq.*
    FROM decision_queue dq
    WHERE dq.tenant_id = _tenant_id
      AND dq.status = 'approved'
      AND dq.action_type IN ('price_adjust','discount_dead_stock','winback_outreach','send_broadcast')
      AND dq.executor_action_id IS NULL
    ORDER BY dq.approved_at NULLS LAST, dq.created_at
    LIMIT 50
  LOOP
    v_agent := _high_impact_agent_for(rec.action_type);
    IF v_agent IS NULL THEN CONTINUE; END IF;

    INSERT INTO ai_actions (
      tenant_id, source_insight_id, action_type, agent_id,
      parameters, expected_impact, status
    ) VALUES (
      rec.tenant_id, rec.insight_id, rec.action_type, v_agent,
      jsonb_build_object(
        'decision_id', rec.id,
        'payload', rec.payload,
        'rationale', rec.rationale,
        'confidence', rec.confidence,
        'expected_impact', rec.expected_impact
      ),
      COALESCE(rec.expected_impact->>'summary', 'high_impact_dispatch'),
      'pending'
    )
    RETURNING id INTO v_action_id;

    UPDATE decision_queue
    SET status = 'executing',
        executor_action_id = v_action_id,
        executed_at = now()
    WHERE id = rec.id;

    INSERT INTO action_outcomes (
      tenant_id, decision_id, action_id, agent_id, action_type,
      baseline, measurement_window, notes
    ) VALUES (
      rec.tenant_id, rec.id, v_action_id, v_agent, rec.action_type,
      jsonb_build_object(
        'captured_at', now(),
        'expected_impact', rec.expected_impact,
        'confidence', rec.confidence
      ),
      '7d',
      'baseline captured at dispatch'
    );

    decision_id := rec.id;
    action_id := v_action_id;
    agent_id := v_agent;
    action_type := rec.action_type;
    RETURN NEXT;
  END LOOP;
END $$;

-- Smoke test: approve 1 of each high-impact type and dispatch
DO $$
BEGIN
  UPDATE decision_queue
  SET status='approved', approved_at=now(), requires_approval=false
  WHERE id IN (
    SELECT DISTINCT ON (action_type) id
    FROM decision_queue
    WHERE action_type IN ('price_adjust','discount_dead_stock','winback_outreach')
      AND status='pending'
    ORDER BY action_type, created_at
  );

  PERFORM dispatch_high_impact_all_tenants();
END $$;