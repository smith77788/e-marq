-- ============================================================================
-- Fix mark_decision_outcome ON CONFLICT target (closed-loop learning)
-- ============================================================================
-- mark_decision_outcome (migration 20260610000001) upserts into ai_memory with
-- ON CONFLICT (tenant_id, pattern_key). Migration 20260610000006 later DROPPED
-- that 2-column unique constraint and replaced it with a 4-column one
-- (tenant_id, agent, category, pattern_key). Since 000006 runs after 000001,
-- the ON CONFLICT clause now matches no constraint and Postgres raises
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
-- The insert is wrapped in EXCEPTION WHEN OTHERS THEN NULL (best-effort), so it
-- does not crash — it SILENTLY fails, and ai_memory never accumulates from
-- decision outcomes. The ACOS closed-loop learning has been a no-op since.
--
-- This re-creates the function unchanged except for the ON CONFLICT target,
-- now matching the live 4-column constraint.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_decision_outcome(
  _decision_id uuid,
  _success boolean,
  _actual jsonb DEFAULT '{}'::jsonb,
  _attributed_revenue_cents bigint DEFAULT 0,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ao_id uuid;
  _baseline jsonb;
  _action_type text;
  _agent_id text;
  _tenant_id uuid;
BEGIN
  SELECT ao.id, ao.baseline, ao.action_type, ao.agent_id, ao.tenant_id
    INTO _ao_id, _baseline, _action_type, _agent_id, _tenant_id
  FROM public.action_outcomes ao
  WHERE ao.decision_id = _decision_id
  ORDER BY ao.measured_at DESC LIMIT 1;

  IF _ao_id IS NULL THEN RETURN; END IF;

  UPDATE public.action_outcomes
     SET actual = _actual,
         delta = COALESCE(_actual, '{}'::jsonb) - COALESCE(_baseline, '{}'::jsonb),
         attributed_revenue_cents = _attributed_revenue_cents,
         success = _success,
         notes = COALESCE(_notes, notes),
         measured_at = now()
   WHERE id = _ao_id;

  -- Write outcome into ai_memory for closed-loop learning.
  BEGIN
    INSERT INTO public.ai_memory (
      tenant_id,
      pattern_key,
      agent,
      category,
      learned_rule,
      evidence,
      avg_impact,
      success_count,
      failure_count,
      confidence,
      last_observed_at
    ) VALUES (
      _tenant_id,
      _action_type || '::outcome',
      COALESCE(_agent_id, 'orchestrator'),
      'decision_outcome',
      'action ' || _action_type || ': ' || CASE WHEN _success THEN 'success' ELSE 'failure' END,
      jsonb_build_object(
        'success', _success,
        'attributed_revenue_cents', _attributed_revenue_cents,
        'agent_id', _agent_id,
        'decision_id', _decision_id::text
      ),
      CASE WHEN _success THEN 1.0 ELSE 0.0 END,
      CASE WHEN _success THEN 1 ELSE 0 END,
      CASE WHEN _success THEN 0 ELSE 1 END,
      CASE WHEN _success THEN 0.7 ELSE 0.3 END,
      now()
    )
    ON CONFLICT (tenant_id, agent, category, pattern_key) DO UPDATE SET
      success_count    = ai_memory.success_count + EXCLUDED.success_count,
      failure_count    = ai_memory.failure_count + EXCLUDED.failure_count,
      avg_impact       = CASE
        WHEN (ai_memory.success_count + ai_memory.failure_count) = 0 THEN EXCLUDED.avg_impact
        ELSE (ai_memory.avg_impact * (ai_memory.success_count + ai_memory.failure_count)
              + EXCLUDED.avg_impact)
             / (ai_memory.success_count + ai_memory.failure_count + 1)
      END,
      confidence       = LEAST(0.95, GREATEST(0.1,
        (ai_memory.success_count + EXCLUDED.success_count)::numeric /
        NULLIF(ai_memory.success_count + ai_memory.failure_count
               + EXCLUDED.success_count + EXCLUDED.failure_count, 0)
      )),
      evidence         = EXCLUDED.evidence,
      last_observed_at = now(),
      updated_at       = now();
  EXCEPTION WHEN OTHERS THEN
    NULL; -- learning is best-effort, never block outcome recording
  END;
END $$;

REVOKE EXECUTE ON FUNCTION public.mark_decision_outcome(uuid, boolean, jsonb, bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_decision_outcome(uuid, boolean, jsonb, bigint, text) TO service_role, authenticated;
