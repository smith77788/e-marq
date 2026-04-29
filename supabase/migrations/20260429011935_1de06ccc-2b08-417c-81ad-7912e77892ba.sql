-- Mapping action_type -> agent_id for high-impact dispatch
CREATE OR REPLACE FUNCTION public._high_impact_agent_for(_action_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _action_type
    WHEN 'price_adjust'        THEN 'price-optimizer'
    WHEN 'discount_dead_stock' THEN 'discount-elasticity'
    WHEN 'winback_outreach'    THEN 'email-winback'
    WHEN 'send_broadcast'      THEN 'broadcast-composer'
    ELSE NULL
  END
$$;

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
      baseline_metrics, status
    ) VALUES (
      rec.tenant_id, rec.id, v_action_id, v_agent, rec.action_type,
      jsonb_build_object(
        'captured_at', now(),
        'expected_impact', rec.expected_impact
      ),
      'pending_measurement'
    )
    ON CONFLICT DO NOTHING;

    decision_id := rec.id;
    action_id := v_action_id;
    agent_id := v_agent;
    action_type := rec.action_type;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.dispatch_high_impact_decisions(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.dispatch_high_impact_all_tenants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  total int := 0;
  per_tenant int;
  results jsonb := '[]'::jsonb;
BEGIN
  FOR t IN
    SELECT id FROM tenants WHERE status IN ('active','pending')
  LOOP
    SELECT COUNT(*) INTO per_tenant
    FROM dispatch_high_impact_decisions(t.id);
    total := total + per_tenant;
    IF per_tenant > 0 THEN
      results := results || jsonb_build_object('tenant_id', t.id, 'dispatched', per_tenant);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'total_dispatched', total,
    'tenants', results
  );
END $$;

REVOKE ALL ON FUNCTION public.dispatch_high_impact_all_tenants() FROM anon, authenticated;

-- Cron: every 5 minutes
SELECT cron.schedule(
  'dispatch-high-impact-every-5min',
  '*/5 * * * *',
  $$ SELECT public.dispatch_high_impact_all_tenants(); $$
);