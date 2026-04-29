
-- Phase 16: Value-aware auto-approval + risk guardrails + daily cap
-- - ORDER BY forecast.expected_revenue DESC (most valuable first within batch)
-- - Skip auto-approval if expected_revenue > 50000 (500₴) AND confidence < 0.4
-- - Daily cap: max 20 auto-approved decisions per tenant per 24h
-- - Logs skip reason in payload.auto_approval_skip_reason

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
  v_high_value_threshold bigint := 50000;  -- 500 UAH
  v_min_confidence numeric := 0.4;
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

    -- Risk guardrail: high-value + low-confidence → leave to owner
    IF v_expected >= v_high_value_threshold AND v_confidence < v_min_confidence THEN
      v_skip_reason := 'high_value_low_confidence';
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
      -- Tag the skip reason for observability (but only if not already tagged for same reason)
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
