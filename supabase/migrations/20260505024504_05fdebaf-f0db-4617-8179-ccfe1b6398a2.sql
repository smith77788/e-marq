
-- 1. Forecast-weighted attribution in measure_pending_outcomes
CREATE OR REPLACE FUNCTION public.measure_pending_outcomes()
 RETURNS TABLE(measured_count integer, success_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_measured int := 0;
  v_succ int := 0;
  d RECORD;
  v_baseline_revenue bigint;
  v_baseline_orders int;
  v_actual_revenue bigint;
  v_actual_orders int;
  v_delta_revenue bigint;
  v_delta_orders int;
  v_share_denom_count int;
  v_my_forecast bigint;
  v_total_forecast bigint;
  v_weight numeric;
  v_attrib bigint;
  v_is_success bool;
  v_post_window interval;
  v_pre_window  interval;
  v_attrib_method text;
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.agent_id, dq.action_type,
           dq.executor_action_id, dq.executed_at,
           COALESCE((dq.payload->'forecast'->>'expected_revenue_cents')::bigint, 0) AS my_forecast
    FROM decision_queue dq
    LEFT JOIN action_outcomes ao ON ao.decision_id = dq.id
    WHERE dq.status = 'done'
      AND dq.executed_at IS NOT NULL
      AND dq.executed_at <= now() - interval '24 hours'
      AND dq.executed_at >  now() - interval '30 days'
      AND ao.id IS NULL
    LIMIT 500
  LOOP
    v_post_window := LEAST(interval '7 days', now() - d.executed_at);
    v_pre_window  := v_post_window;

    SELECT COALESCE(SUM(total_cents), 0)::bigint, COUNT(*)::int
      INTO v_baseline_revenue, v_baseline_orders
    FROM orders
    WHERE tenant_id = d.tenant_id
      AND status IN ('paid', 'fulfilled')
      AND created_at >= d.executed_at - v_pre_window
      AND created_at <  d.executed_at;

    SELECT COALESCE(SUM(total_cents), 0)::bigint, COUNT(*)::int
      INTO v_actual_revenue, v_actual_orders
    FROM orders
    WHERE tenant_id = d.tenant_id
      AND status IN ('paid', 'fulfilled')
      AND created_at >  d.executed_at
      AND created_at <= d.executed_at + v_post_window;

    v_delta_revenue := v_actual_revenue - v_baseline_revenue;
    v_delta_orders  := v_actual_orders  - v_baseline_orders;

    -- Cohort of done decisions in ±3d window for proportional split
    SELECT COUNT(*)::int,
           COALESCE(SUM(COALESCE((dq2.payload->'forecast'->>'expected_revenue_cents')::bigint, 0)), 0)::bigint
      INTO v_share_denom_count, v_total_forecast
      FROM decision_queue dq2
     WHERE dq2.tenant_id = d.tenant_id
       AND dq2.status = 'done'
       AND dq2.executed_at IS NOT NULL
       AND dq2.executed_at >= d.executed_at - interval '3 days'
       AND dq2.executed_at <= d.executed_at + interval '3 days';

    v_share_denom_count := GREATEST(v_share_denom_count, 1);
    v_my_forecast := d.my_forecast;

    -- Forecast-weighted split when total_forecast > 0; otherwise equal share fallback
    IF v_total_forecast > 0 AND v_my_forecast > 0 THEN
      v_weight := v_my_forecast::numeric / v_total_forecast::numeric;
      v_attrib_method := 'forecast_weighted';
    ELSE
      v_weight := 1.0 / v_share_denom_count::numeric;
      v_attrib_method := 'equal_split';
    END IF;

    v_attrib := GREATEST(v_delta_revenue, 0) * v_weight;
    v_is_success := v_attrib > 0;

    INSERT INTO action_outcomes (
      tenant_id, decision_id, action_id, agent_id, action_type,
      baseline, actual, delta,
      attributed_revenue_cents, success, measurement_window, measured_at, notes
    ) VALUES (
      d.tenant_id, d.id, d.executor_action_id, d.agent_id, d.action_type,
      jsonb_build_object('revenue_cents', v_baseline_revenue, 'orders_count', v_baseline_orders, 'window_hours', round(EXTRACT(EPOCH FROM v_pre_window)/3600.0, 2)),
      jsonb_build_object('revenue_cents', v_actual_revenue,   'orders_count', v_actual_orders,   'window_hours', round(EXTRACT(EPOCH FROM v_post_window)/3600.0, 2)),
      jsonb_build_object('revenue_cents', v_delta_revenue, 'orders_count', v_delta_orders,
                         'cohort_size', v_share_denom_count, 'cohort_total_forecast_cents', v_total_forecast,
                         'my_forecast_cents', v_my_forecast, 'weight', round(v_weight, 4),
                         'attrib_method', v_attrib_method),
      v_attrib, v_is_success,
      'adaptive_pre_vs_post_split', now(),
      public._measurement_explain(v_baseline_revenue, v_actual_revenue, v_delta_revenue,
                                  v_baseline_orders, v_actual_orders, v_share_denom_count, v_attrib)
    );

    v_measured := v_measured + 1;
    IF v_is_success THEN v_succ := v_succ + 1; END IF;
  END LOOP;

  measured_count := v_measured;
  success_count := v_succ;
  RETURN NEXT;
END;
$function$;

-- 2. Archive stale owner-facing decisions
CREATE OR REPLACE FUNCTION public.archive_stale_decisions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.decision_queue
       SET status = 'skipped',
           updated_at = now(),
           payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
             'archived_reason', 'auto_archived_stale',
             'archived_at', now(),
             'archived_after_days', 7
           )
     WHERE status = 'pending'
       AND created_at < now() - interval '7 days'
       AND action_type IN ('owner_setup_task','owner_review','owner_review_rules','flag_for_review')
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN jsonb_build_object('archived', v_count, 'at', now());
END;
$function$;

-- 3. Calibration-aware auto-approval (skip if MAPE > 150% for that tenant+action_type)
CREATE OR REPLACE FUNCTION public.auto_approve_eligible_decisions()
 RETURNS TABLE(approved_count integer, by_action jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_approved int := 0;
  v_breakdown jsonb := '{}'::jsonb;
  d RECORD;
  v_history_succ int;
  v_history_total int;
  v_min_succ int;
  v_bootstrap_cap int := 3;
  v_mode text;
  v_key text;
  v_used int;
  v_counters jsonb := '{}'::jsonb;
  v_tenant_daily_count int;
  v_tenant_daily_cap int := 20;
  v_tenant_daily jsonb := '{}'::jsonb;
  v_expected bigint;
  v_confidence numeric;
  v_skip_reason text;
  v_high_value_threshold bigint := 50000;
  v_min_confidence numeric := 0.4;
  v_max_mape numeric := 150.0;
  v_mape numeric;
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.action_type, dq.created_at, dq.payload,
           COALESCE((dq.payload->'forecast'->>'expected_revenue_cents')::bigint, 0) AS forecast_value,
           COALESCE((dq.payload->'forecast'->>'confidence')::numeric, 0) AS forecast_conf
      FROM public.decision_queue dq
      JOIN public.auto_approval_policy p
        ON p.action_type = dq.action_type AND p.enabled = true
     WHERE dq.status = 'pending'
       AND dq.created_at > now() - (p.max_age_hours || ' hours')::interval
       AND COALESCE((dq.payload->>'requires_owner')::bool, false) = false
     ORDER BY
       COALESCE((dq.payload->'forecast'->>'expected_revenue_cents')::bigint, 0) DESC,
       dq.created_at ASC
  LOOP
    v_expected := d.forecast_value;
    v_confidence := d.forecast_conf;
    v_skip_reason := NULL;

    -- Risk guardrail: high-value + low-confidence
    IF v_expected >= v_high_value_threshold AND v_confidence < v_min_confidence THEN
      v_skip_reason := 'high_value_low_confidence';
    END IF;

    -- Calibration gate: skip if MAPE > 150% for this tenant+action_type
    IF v_skip_reason IS NULL THEN
      SELECT mape_pct INTO v_mape
        FROM public.forecast_calibration
       WHERE tenant_id = d.tenant_id
         AND action_type = d.action_type
         AND computed_at > now() - interval '7 days'
       ORDER BY computed_at DESC
       LIMIT 1;
      IF v_mape IS NOT NULL AND v_mape > v_max_mape THEN
        v_skip_reason := 'forecast_uncalibrated';
      END IF;
    END IF;

    -- Daily cap per tenant
    IF v_skip_reason IS NULL THEN
      v_key := d.tenant_id::text;
      IF NOT (v_tenant_daily ? v_key) THEN
        SELECT count(*) INTO v_tenant_daily_count
          FROM public.decision_queue
         WHERE tenant_id = d.tenant_id
           AND approved_by_auto = true
           AND approved_at > now() - interval '24h';
        v_tenant_daily := jsonb_set(v_tenant_daily, ARRAY[v_key], to_jsonb(v_tenant_daily_count));
      END IF;
      v_tenant_daily_count := (v_tenant_daily->>v_key)::int;
      IF v_tenant_daily_count >= v_tenant_daily_cap THEN
        v_skip_reason := 'daily_cap_reached';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      UPDATE public.decision_queue
         SET payload = COALESCE(payload,'{}'::jsonb) ||
                       jsonb_build_object('auto_approval_skip_reason', v_skip_reason,
                                          'auto_approval_skipped_at', now())
       WHERE id = d.id
         AND COALESCE(payload->>'auto_approval_skip_reason','') IS DISTINCT FROM v_skip_reason;
      CONTINUE;
    END IF;

    SELECT min_success_history INTO v_min_succ
      FROM public.auto_approval_policy WHERE action_type = d.action_type;

    SELECT count(*) FILTER (WHERE success=true), count(*)
      INTO v_history_succ, v_history_total
      FROM public.action_outcomes
     WHERE tenant_id = d.tenant_id AND action_type = d.action_type;

    v_mode := NULL;
    IF v_history_succ >= v_min_succ THEN
      v_mode := 'history';
    ELSIF v_history_total = 0 THEN
      v_key := d.tenant_id::text || '/' || d.action_type;
      IF NOT (v_counters ? v_key) THEN
        SELECT count(*) INTO v_used
          FROM public.decision_queue
         WHERE tenant_id = d.tenant_id
           AND action_type = d.action_type
           AND approved_by_auto = true
           AND payload->>'approval_mode' = 'bootstrap';
        v_counters := jsonb_set(v_counters, ARRAY[v_key], to_jsonb(v_used));
      END IF;
      v_used := (v_counters->>v_key)::int;
      IF v_used < v_bootstrap_cap THEN
        v_mode := 'bootstrap';
      END IF;
    END IF;

    IF v_mode IS NOT NULL THEN
      UPDATE public.decision_queue
         SET status = 'approved',
             updated_at = now(),
             approved_at = now(),
             approved_by_auto = true,
             payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('approval_mode', v_mode)
       WHERE id = d.id AND status = 'pending';

      IF FOUND THEN
        v_approved := v_approved + 1;
        v_breakdown := jsonb_set(
          v_breakdown,
          ARRAY[d.action_type],
          to_jsonb(COALESCE((v_breakdown->>d.action_type)::int, 0) + 1)
        );
        v_key := d.tenant_id::text;
        v_tenant_daily := jsonb_set(
          v_tenant_daily, ARRAY[v_key],
          to_jsonb(((v_tenant_daily->>v_key)::int) + 1)
        );
        IF v_mode = 'bootstrap' THEN
          v_key := d.tenant_id::text || '/' || d.action_type;
          v_counters := jsonb_set(
            v_counters, ARRAY[v_key],
            to_jsonb(((v_counters->>v_key)::int) + 1)
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  approved_count := v_approved;
  by_action := v_breakdown;
  RETURN NEXT;
END;
$function$;

-- 4. Schedule archive_stale_decisions hourly (via existing cron infra)
SELECT cron.schedule(
  'archive-stale-decisions-hourly',
  '47 * * * *',
  $cron$ SELECT public.archive_stale_decisions(); $cron$
);
