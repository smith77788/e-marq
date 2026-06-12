-- Fix ACOS loop race condition: two competing insight→decision converters.
--
-- Problem: propose_decisions_from_insights() (runs every 15min, processes status='new')
-- and convert_insights_to_decisions() (called by run_sql_loop_tick every 30min,
-- processes status IN ('new','in_review')) both read 'new' insights simultaneously.
-- The v3 converter also marks insights 'applied' immediately on decision creation
-- (before execution), breaking the insight lifecycle.
--
-- Fix:
--   1. convert_insights_to_decisions() → only processes 'in_review' (manual review path),
--      sets status to 'queued' (not 'applied') when decision created
--   2. run_sql_loop_tick() → calls propose_decisions_all_tenants() for 'new' insights
--      before convert (in_review) and auto_approve → execute → measure

-- ============================================================
-- 1. Fix convert_insights_to_decisions: only handle 'in_review', not 'new'
--    'new' insights are handled exclusively by propose_decisions_from_insights()
-- ============================================================
CREATE OR REPLACE FUNCTION public.convert_insights_to_decisions()
RETURNS TABLE(converted int, skipped int, by_action jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_converted int := 0;
  v_skipped   int := 0;
  v_by        jsonb := '{}'::jsonb;
  i           RECORD;
  v_action    text;
  v_owner_action bool;
BEGIN
  -- Only process insights that have been explicitly moved to 'in_review' by a human.
  -- 'new' insights go through propose_decisions_from_insights() instead.
  FOR i IN
    SELECT * FROM public.ai_insights
     WHERE status = 'in_review'
       AND created_at > now() - interval '30 days'
     ORDER BY created_at ASC
     LIMIT 200
  LOOP
    -- Skip if a live decision already exists for this insight
    IF EXISTS (
      SELECT 1 FROM public.decision_queue dq
       WHERE dq.insight_id = i.id
         AND dq.status NOT IN ('rejected','expired','failed')
    ) THEN
      -- Decision already exists; mark queued so it doesn't loop
      UPDATE public.ai_insights SET status='queued', updated_at=now() WHERE id=i.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_action := public._map_insight_to_action(i.insight_type);
    -- Fall back to owner_review so unmapped types aren't silently dropped
    IF v_action IS NULL THEN
      v_action := 'owner_review';
    END IF;
    v_owner_action := v_action IN ('owner_setup_task','owner_review','flag_for_review');

    INSERT INTO public.decision_queue(
      tenant_id, insight_id, agent_id, action_type, title, rationale,
      payload, status, confidence, expected_impact, requires_approval,
      expires_at, created_at, updated_at
    ) VALUES (
      i.tenant_id, i.id, 'manual_review_converter', v_action,
      COALESCE(NULLIF(i.title,''), i.insight_type),
      i.description,
      jsonb_build_object(
        'insight_id',   i.id,
        'insight_type', i.insight_type,
        'metrics',      i.metrics,
        'risk_level',   i.risk_level,
        'requires_owner', v_owner_action
      ),
      'pending',
      COALESCE(i.confidence, 0.5),
      jsonb_build_object('summary', COALESCE(i.expected_impact, 'unknown'),
                         'risk_level', COALESCE(i.risk_level, 'low')),
      v_owner_action,
      now() + interval '7 days',
      now(), now()
    );

    -- 'queued' = decision created, waiting for approval/execution
    UPDATE public.ai_insights SET status='queued', updated_at=now() WHERE id=i.id;

    v_converted := v_converted + 1;
    v_by := jsonb_set(v_by, ARRAY[v_action],
                      to_jsonb(COALESCE((v_by->>v_action)::int, 0) + 1));
  END LOOP;

  RETURN QUERY SELECT v_converted, v_skipped, v_by;
END;
$$;

-- ============================================================
-- 2. Update run_sql_loop_tick to run the full canonical pipeline:
--    propose (new→proposed) → convert (in_review→queued) → auto_approve → execute → measure
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_sql_loop_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_prop  jsonb;
  v_conv  RECORD;
  v_appr  RECORD;
  v_exec  jsonb;
  v_meas  RECORD;
BEGIN
  -- Step 1: Convert 'new' insights → decision_queue (sets insight to 'proposed')
  v_prop := public.propose_decisions_all_tenants();

  -- Step 2: Convert manually-reviewed 'in_review' insights → decision_queue
  SELECT * INTO v_conv FROM public.convert_insights_to_decisions();

  -- Step 3: Auto-approve eligible pending decisions
  SELECT * INTO v_appr FROM public.auto_approve_eligible_decisions();

  -- Step 4: Execute approved in-DB-safe decisions
  v_exec := public.execute_decisions_all_tenants();

  -- Step 5: Measure outcomes for decisions past their window
  SELECT * INTO v_meas FROM public.measure_pending_outcomes();

  RETURN jsonb_build_object(
    'proposed',         v_prop,
    'converted',        v_conv.converted,
    'convert_skipped',  v_conv.skipped,
    'convert_by',       v_conv.by_action,
    'approved',         v_appr.approved_count,
    'approved_by',      v_appr.by_action,
    'execute_result',   v_exec,
    'measured',         v_meas.measured_count,
    'measure_success',  v_meas.success_count,
    'ts',               now()
  );
END;
$$;

-- Keep the cron schedules as-is; run_sql_loop_tick already fires every 30min
-- and propose_decisions_from_insights fires separately every 15min (that's fine,
-- they no longer conflict because convert only touches 'in_review').
