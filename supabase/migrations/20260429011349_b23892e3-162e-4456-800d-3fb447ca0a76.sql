
-- Set of action types we can safely complete in-DB (no external side effects)
CREATE OR REPLACE FUNCTION public._is_in_db_safe_action(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _t IN (
    'owner_setup_task','owner_review','owner_review_rules','flag_for_review',
    'feature_product','request_review','request_ugc',
    'repeat_purchase_nudge','cross_sell_recommend'
  )
$$;

CREATE OR REPLACE FUNCTION public.execute_pending_decisions(_tenant uuid, _limit int DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _d record; _action_id uuid; _executed int := 0;
BEGIN
  FOR _d IN
    SELECT * FROM public.decision_queue
    WHERE tenant_id = _tenant
      AND status = 'approved'
      AND public._is_in_db_safe_action(action_type)
    ORDER BY confidence DESC, created_at ASC
    LIMIT _limit
  LOOP
    BEGIN
      -- mark executing
      UPDATE public.decision_queue SET status = 'executing', updated_at = now() WHERE id = _d.id;

      -- write into ai_actions (legacy telemetry; UI reads this)
      INSERT INTO public.ai_actions (
        tenant_id, source_insight_id, action_type, agent_id, parameters,
        expected_impact, status, target_entity, applied_at, created_at, updated_at
      ) VALUES (
        _d.tenant_id, _d.insight_id, _d.action_type, _d.agent_id,
        jsonb_build_object(
          'decision_id', _d.id,
          'payload', _d.payload,
          'rationale', _d.rationale,
          'triggered_by', 'orchestrator'
        ),
        COALESCE(_d.expected_impact->>'summary', 'unknown'),
        'applied',
        CASE WHEN _d.action_type IN ('feature_product','repeat_purchase_nudge','cross_sell_recommend')
             THEN 'product' ELSE NULL END,
        now(), now(), now()
      )
      RETURNING id INTO _action_id;

      -- baseline action_outcome row
      INSERT INTO public.action_outcomes (
        tenant_id, decision_id, action_id, agent_id, action_type,
        baseline, measurement_window, measured_at
      ) VALUES (
        _d.tenant_id, _d.id, _action_id, _d.agent_id, _d.action_type,
        _d.payload, '7d', now()
      );

      -- mark decision done
      UPDATE public.decision_queue
         SET status = 'done',
             executed_at = now(),
             executor_action_id = _action_id,
             updated_at = now()
       WHERE id = _d.id;

      -- mark insight applied
      IF _d.insight_id IS NOT NULL THEN
        UPDATE public.ai_insights SET status = 'applied', updated_at = now()
        WHERE id = _d.insight_id;
      END IF;

      _executed := _executed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.decision_queue
         SET status = 'failed', rejected_reason = SQLERRM, updated_at = now()
       WHERE id = _d.id;
    END;
  END LOOP;
  RETURN _executed;
END $$;

CREATE OR REPLACE FUNCTION public.execute_decisions_all_tenants()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _result jsonb := '[]'::jsonb; _n int;
BEGIN
  FOR _t IN SELECT id FROM public.tenants WHERE status IN ('active','pending') LOOP
    BEGIN
      _n := public.execute_pending_decisions(_t.id);
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'executed', _n);
    EXCEPTION WHEN OTHERS THEN
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN _result;
END $$;

-- Outcome back-fill (called by measurement agents after window)
CREATE OR REPLACE FUNCTION public.mark_decision_outcome(
  _decision_id uuid,
  _success boolean,
  _actual jsonb DEFAULT '{}'::jsonb,
  _attributed_revenue_cents bigint DEFAULT 0,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ao_id uuid; _baseline jsonb;
BEGIN
  SELECT id, baseline INTO _ao_id, _baseline
  FROM public.action_outcomes
  WHERE decision_id = _decision_id
  ORDER BY measured_at DESC LIMIT 1;

  IF _ao_id IS NULL THEN RETURN; END IF;

  UPDATE public.action_outcomes
     SET actual = _actual,
         delta = COALESCE(_actual,'{}'::jsonb) - COALESCE(_baseline,'{}'::jsonb),
         attributed_revenue_cents = _attributed_revenue_cents,
         success = _success,
         notes = COALESCE(_notes, notes),
         measured_at = now()
   WHERE id = _ao_id;

  -- write into ai_memory for closed-loop learning (best-effort)
  BEGIN
    INSERT INTO public.ai_memory (tenant_id, scope, key, value, created_at)
    SELECT ao.tenant_id,
           'decision_outcome',
           ao.action_type || '::' || ao.decision_id::text,
           jsonb_build_object(
             'success', _success,
             'attributed_revenue_cents', _attributed_revenue_cents,
             'agent_id', ao.agent_id
           ),
           now()
      FROM public.action_outcomes ao WHERE ao.id = _ao_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

REVOKE EXECUTE ON FUNCTION public.execute_pending_decisions(uuid, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.execute_decisions_all_tenants() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_decision_outcome(uuid, boolean, jsonb, bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.execute_pending_decisions(uuid, int) TO service_role, authenticated;
GRANT  EXECUTE ON FUNCTION public.execute_decisions_all_tenants() TO service_role;
GRANT  EXECUTE ON FUNCTION public.mark_decision_outcome(uuid, boolean, jsonb, bigint, text) TO service_role, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('execute-decisions-every-10min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'execute-decisions-every-10min',
  '*/10 * * * *',
  $cmd$ SELECT public.execute_decisions_all_tenants(); $cmd$
);
