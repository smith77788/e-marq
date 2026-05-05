
-- ============================================================
-- causal_experiments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.causal_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  action_type text NOT NULL,
  window_days integer NOT NULL DEFAULT 30,
  treatment_n integer NOT NULL,
  control_n integer NOT NULL,
  treatment_mean_cents bigint NOT NULL,
  control_mean_cents bigint NOT NULL,
  treatment_stddev numeric,
  control_stddev numeric,
  causal_lift_cents bigint NOT NULL,
  t_statistic numeric,
  confidence_label text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT causal_experiments_unique UNIQUE (tenant_id, action_type, window_days)
);

CREATE INDEX IF NOT EXISTS idx_causal_experiments_tenant ON public.causal_experiments(tenant_id, action_type);

ALTER TABLE public.causal_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_read_causal" ON public.causal_experiments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_memberships tm
            WHERE tm.tenant_id = causal_experiments.tenant_id
              AND tm.user_id = auth.uid())
  );

CREATE POLICY "service_role_all_causal" ON public.causal_experiments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Patch auto_approve_eligible_decisions(): 10% holdout assignment
-- ============================================================
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
  v_holdout_pct numeric := 0.10;
  v_is_holdout boolean;
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

    IF v_expected >= v_high_value_threshold AND v_confidence < v_min_confidence THEN
      v_skip_reason := 'high_value_low_confidence';
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT mape_pct INTO v_mape
        FROM public.forecast_calibration
       WHERE tenant_id = d.tenant_id AND action_type = d.action_type
         AND computed_at > now() - interval '7 days'
       ORDER BY computed_at DESC LIMIT 1;
      IF v_mape IS NOT NULL AND v_mape > v_max_mape THEN
        v_skip_reason := 'forecast_uncalibrated';
      END IF;
    END IF;

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
        v_counters := jsonb_set(v_counters, ARRAY[v_key], to_jsonb(v_used + 1));
      END IF;
    END IF;

    IF v_mode IS NULL THEN
      CONTINUE;
    END IF;

    -- Causal holdout: 10% of eligible decisions become control
    v_is_holdout := (random() < v_holdout_pct);

    IF v_is_holdout THEN
      UPDATE public.decision_queue
         SET status = 'rejected',
             rejected_reason = 'causal_holdout',
             payload = COALESCE(payload,'{}'::jsonb) ||
                       jsonb_build_object('holdout', true,
                                          'holdout_assigned_at', now(),
                                          'approval_mode', v_mode),
             updated_at = now()
       WHERE id = d.id;
    ELSE
      UPDATE public.decision_queue
         SET status = 'approved',
             approved_at = now(),
             approved_by_auto = true,
             payload = COALESCE(payload,'{}'::jsonb) ||
                       jsonb_build_object('approval_mode', v_mode,
                                          'holdout', false),
             updated_at = now()
       WHERE id = d.id;
      v_approved := v_approved + 1;
      v_breakdown := jsonb_set(
        v_breakdown,
        ARRAY[d.action_type],
        to_jsonb(COALESCE((v_breakdown->>d.action_type)::int, 0) + 1)
      );
      v_tenant_daily := jsonb_set(v_tenant_daily, ARRAY[d.tenant_id::text],
                                  to_jsonb(v_tenant_daily_count + 1));
    END IF;
  END LOOP;

  approved_count := v_approved;
  by_action := v_breakdown;
  RETURN NEXT;
END;
$function$;

-- ============================================================
-- compute_causal_lift()
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_causal_lift()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  r RECORD;
  v_t_n int; v_c_n int;
  v_t_mean numeric; v_c_mean numeric;
  v_t_sd numeric; v_c_sd numeric;
  v_t_stat numeric;
  v_label text;
  v_lift bigint;
  v_window_days int := 30;
BEGIN
  FOR r IN
    SELECT t.id AS tenant_id, dq.action_type
      FROM public.tenants t
      JOIN public.decision_queue dq ON dq.tenant_id = t.id
     WHERE t.status IN ('active','pending')
       AND COALESCE(t.is_pilot,false) = false
       AND dq.created_at > now() - (v_window_days || ' days')::interval
       AND dq.payload ? 'holdout'
     GROUP BY t.id, dq.action_type
  LOOP
    -- Treatment: action_outcomes for non-holdout done decisions
    SELECT count(*),
           AVG(GREATEST(ao.attributed_revenue_cents,0))::numeric,
           COALESCE(stddev_samp(GREATEST(ao.attributed_revenue_cents,0)),0)::numeric
      INTO v_t_n, v_t_mean, v_t_sd
      FROM public.action_outcomes ao
      JOIN public.decision_queue dq ON dq.id = ao.decision_id
     WHERE ao.tenant_id = r.tenant_id
       AND dq.action_type = r.action_type
       AND COALESCE((dq.payload->>'holdout')::bool, false) = false
       AND ao.measured_at > now() - (v_window_days || ' days')::interval;

    -- Control: simulate post-pre delta around holdout decisions' created_at
    WITH holdouts AS (
      SELECT id, created_at
        FROM public.decision_queue
       WHERE tenant_id = r.tenant_id
         AND action_type = r.action_type
         AND COALESCE((payload->>'holdout')::bool, false) = true
         AND created_at > now() - (v_window_days || ' days')::interval
         AND created_at < now() - interval '24 hours'
    ),
    deltas AS (
      SELECT h.id,
        (SELECT COALESCE(SUM(o.total_cents),0)
           FROM public.orders o
          WHERE o.tenant_id = r.tenant_id AND o.status='paid'
            AND o.paid_at >= h.created_at
            AND o.paid_at < h.created_at + interval '3 days')
        -
        (SELECT COALESCE(SUM(o.total_cents),0)
           FROM public.orders o
          WHERE o.tenant_id = r.tenant_id AND o.status='paid'
            AND o.paid_at >= h.created_at - interval '3 days'
            AND o.paid_at < h.created_at) AS delta_cents
      FROM holdouts h
    )
    SELECT count(*),
           COALESCE(AVG(delta_cents),0)::numeric,
           COALESCE(stddev_samp(delta_cents),0)::numeric
      INTO v_c_n, v_c_mean, v_c_sd
      FROM deltas;

    IF v_t_n < 1 OR v_c_n < 1 THEN
      v_label := 'insufficient';
      v_t_stat := NULL;
    ELSE
      -- Welch's t-statistic (approx)
      IF (v_t_sd*v_t_sd/GREATEST(v_t_n,1) + v_c_sd*v_c_sd/GREATEST(v_c_n,1)) > 0 THEN
        v_t_stat := (v_t_mean - v_c_mean) /
                    sqrt(v_t_sd*v_t_sd/v_t_n + v_c_sd*v_c_sd/v_c_n);
      ELSE
        v_t_stat := NULL;
      END IF;

      v_label := CASE
        WHEN v_t_n < 3 OR v_c_n < 3 THEN 'low'
        WHEN v_t_stat IS NULL THEN 'low'
        WHEN abs(v_t_stat) >= 2.0 THEN 'high'
        WHEN abs(v_t_stat) >= 1.3 THEN 'medium'
        ELSE 'low'
      END;
    END IF;

    v_lift := ROUND(v_t_mean - v_c_mean)::bigint;

    INSERT INTO public.causal_experiments
      (tenant_id, action_type, window_days, treatment_n, control_n,
       treatment_mean_cents, control_mean_cents, treatment_stddev, control_stddev,
       causal_lift_cents, t_statistic, confidence_label, computed_at)
    VALUES
      (r.tenant_id, r.action_type, v_window_days, v_t_n, v_c_n,
       ROUND(v_t_mean)::bigint, ROUND(v_c_mean)::bigint, v_t_sd, v_c_sd,
       v_lift, v_t_stat, v_label, now())
    ON CONFLICT (tenant_id, action_type, window_days) DO UPDATE SET
      treatment_n = EXCLUDED.treatment_n,
      control_n = EXCLUDED.control_n,
      treatment_mean_cents = EXCLUDED.treatment_mean_cents,
      control_mean_cents = EXCLUDED.control_mean_cents,
      treatment_stddev = EXCLUDED.treatment_stddev,
      control_stddev = EXCLUDED.control_stddev,
      causal_lift_cents = EXCLUDED.causal_lift_cents,
      t_statistic = EXCLUDED.t_statistic,
      confidence_label = EXCLUDED.confidence_label,
      computed_at = now();

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('causal_lift_compute'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('causal_lift_compute', '17 */6 * * *', $$ SELECT public.compute_causal_lift(); $$);
