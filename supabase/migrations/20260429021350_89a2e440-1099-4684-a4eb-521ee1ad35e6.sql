CREATE OR REPLACE FUNCTION public.run_sql_loop_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_conv RECORD;
  v_appr RECORD;
  v_exec text;
  v_meas_demo text;
  v_meas_full text;
BEGIN
  SELECT * INTO v_conv FROM public.convert_insights_to_decisions();
  SELECT * INTO v_appr FROM public.auto_approve_eligible_decisions();
  v_exec     := public.execute_decisions_all_tenants()::text;
  v_meas_demo:= public.demo_measure_recent_outcomes()::text;
  v_meas_full:= public.measure_pending_outcomes()::text;
  RETURN jsonb_build_object(
    'converted', v_conv.converted, 'convert_skipped', v_conv.skipped,
    'convert_by', v_conv.by_action,
    'approved', v_appr.approved_count, 'approved_by', v_appr.by_action,
    'execute_result', v_exec,
    'measure_demo', v_meas_demo,
    'measure_full', v_meas_full,
    'ts', now()
  );
END;
$$;