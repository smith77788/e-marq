-- 1) mapper
CREATE OR REPLACE FUNCTION public._map_insight_to_action(_insight_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _insight_type
    WHEN 'churn_risk'              THEN 'winback_outreach'
    WHEN 'vip_silent'              THEN 'winback_outreach'
    WHEN 'dead_stock'              THEN 'discount_dead_stock'
    WHEN 'price_optimization'      THEN 'price_adjust'
    WHEN 'stockout_critical'       THEN 'owner_setup_task'
    WHEN 'low_stock'               THEN 'owner_setup_task'
    WHEN 'refund_risk_high'        THEN 'flag_for_review'
    WHEN 'cross_sell_opportunity'  THEN 'cross_sell_recommend'
    WHEN 'review_opportunity'      THEN 'request_review'
    WHEN 'ugc_opportunity'         THEN 'request_ugc'
    WHEN 'feature_product_opp'     THEN 'feature_product'
    WHEN 'repeat_purchase_opp'     THEN 'repeat_purchase_nudge'
    ELSE
      CASE
        WHEN _insight_type LIKE 'bootstrap\_%' ESCAPE '\' THEN 'owner_setup_task'
        WHEN _insight_type LIKE 'setup\_%'     ESCAPE '\' THEN 'owner_setup_task'
        ELSE NULL
      END
  END;
$$;

-- 2) converter
CREATE OR REPLACE FUNCTION public.convert_insights_to_decisions()
RETURNS TABLE(converted int, skipped int, by_action jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_converted int := 0;
  v_skipped   int := 0;
  v_by jsonb := '{}'::jsonb;
  i RECORD;
  v_action text;
  v_owner_action bool;
  v_new_id uuid;
BEGIN
  FOR i IN
    SELECT * FROM public.ai_insights
     WHERE status = 'in_review'
       AND created_at > now() - interval '30 days'
     ORDER BY created_at ASC
     LIMIT 200
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.decision_queue dq
       WHERE dq.insight_id = i.id
          OR (dq.payload->>'insight_id')::text = i.id::text
    ) THEN
      UPDATE public.ai_insights SET status='queued', updated_at=now() WHERE id=i.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_action := public._map_insight_to_action(i.insight_type);
    IF v_action IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    v_owner_action := v_action IN ('owner_setup_task','owner_review','flag_for_review');

    INSERT INTO public.decision_queue(
      tenant_id, insight_id, agent_id, action_type, title, rationale,
      payload, status, confidence, expected_impact, requires_approval,
      created_at, updated_at
    ) VALUES (
      i.tenant_id, i.id, 'sql_insight_converter', v_action,
      COALESCE(NULLIF(i.title,''), i.insight_type),
      i.description,
      jsonb_build_object(
        'insight_id', i.id, 'insight_type', i.insight_type,
        'metrics', i.metrics, 'risk_level', i.risk_level,
        'requires_owner', v_owner_action
      ),
      'pending',
      COALESCE(i.confidence, 0.5),
      COALESCE(i.expected_impact, '{}'::jsonb),
      v_owner_action,
      now(), now()
    ) RETURNING id INTO v_new_id;

    UPDATE public.ai_insights SET status='queued', updated_at=now() WHERE id=i.id;

    v_converted := v_converted + 1;
    v_by := jsonb_set(v_by, ARRAY[v_action], to_jsonb(COALESCE((v_by->>v_action)::int,0)+1));
  END LOOP;

  RETURN QUERY SELECT v_converted, v_skipped, v_by;
END;
$$;

-- 3) full SQL pipeline tick
CREATE OR REPLACE FUNCTION public.run_sql_loop_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_conv RECORD;
  v_appr RECORD;
  v_exec text;
  v_meas text;
BEGIN
  SELECT * INTO v_conv FROM public.convert_insights_to_decisions();
  SELECT * INTO v_appr FROM public.auto_approve_eligible_decisions();
  v_exec := public.execute_decisions_all_tenants()::text;
  v_meas := public.measure_pending_outcomes()::text;
  RETURN jsonb_build_object(
    'converted', v_conv.converted, 'convert_skipped', v_conv.skipped,
    'convert_by', v_conv.by_action,
    'approved', v_appr.approved_count, 'approved_by', v_appr.by_action,
    'execute_result', v_exec, 'measure_result', v_meas,
    'ts', now()
  );
END;
$$;

-- 4) cron — every 30 min
SELECT cron.unschedule('sql-loop-tick-30min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sql-loop-tick-30min');
SELECT cron.schedule('sql-loop-tick-30min', '*/30 * * * *', $cron$SELECT public.run_sql_loop_tick();$cron$);