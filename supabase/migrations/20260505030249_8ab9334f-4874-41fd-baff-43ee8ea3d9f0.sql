
CREATE OR REPLACE FUNCTION public.enforce_causal_policy()
RETURNS TABLE(disabled_count integer, enabled_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_disabled int := 0;
  v_enabled int := 0;
  v_currently_enabled boolean;
  v_note_marker text := '[causal_auto_disabled]';
BEGIN
  -- Disable: high-confidence loss
  FOR r IN
    SELECT DISTINCT ON (action_type)
           action_type, causal_lift_cents, treatment_n, control_n, t_statistic
      FROM public.causal_experiments
     WHERE confidence_label = 'high'
       AND causal_lift_cents <= 0
       AND computed_at > now() - interval '7 days'
     ORDER BY action_type, computed_at DESC
  LOOP
    SELECT enabled INTO v_currently_enabled
      FROM public.auto_approval_policy
     WHERE action_type = r.action_type;

    IF v_currently_enabled IS TRUE THEN
      UPDATE public.auto_approval_policy
         SET enabled = false,
             notes = COALESCE(notes,'') || ' ' || v_note_marker || ' '
                     || format('Disabled %s: causal_lift=%s cents (t=%s, nT=%s, nC=%s).',
                               to_char(now(),'YYYY-MM-DD'),
                               r.causal_lift_cents, ROUND(r.t_statistic,2),
                               r.treatment_n, r.control_n),
             updated_at = now()
       WHERE action_type = r.action_type;
      v_disabled := v_disabled + 1;

      INSERT INTO public.owner_notifications
        (tenant_id, kind, severity, title, body, link, channel, metadata, created_at)
      SELECT t.id,
             'policy_change',
             'warning',
             format('Auto-disabled action: %s', r.action_type),
             format('Causal evidence shows no positive lift (lift=$%s, t=%s, n=%s vs %s). Auto-approval suspended pending review.',
                    ROUND(r.causal_lift_cents/100.0,2), ROUND(r.t_statistic,2),
                    r.treatment_n, r.control_n),
             '/brand/decisions',
             'in_app',
             jsonb_build_object('action_type', r.action_type,
                                'change', 'disabled',
                                'causal_lift_cents', r.causal_lift_cents,
                                't_statistic', r.t_statistic,
                                'treatment_n', r.treatment_n,
                                'control_n', r.control_n),
             now()
        FROM public.tenants t
       WHERE t.status IN ('active','pending')
         AND COALESCE(t.is_pilot,false) = false;
    END IF;
  END LOOP;

  -- Re-enable: previously auto-disabled, now showing positive high-confidence lift
  FOR r IN
    SELECT DISTINCT ON (action_type)
           action_type, causal_lift_cents, t_statistic, treatment_n, control_n
      FROM public.causal_experiments
     WHERE confidence_label = 'high'
       AND causal_lift_cents > 0
       AND computed_at > now() - interval '7 days'
     ORDER BY action_type, computed_at DESC
  LOOP
    SELECT enabled INTO v_currently_enabled
      FROM public.auto_approval_policy
     WHERE action_type = r.action_type;

    IF v_currently_enabled IS FALSE
       AND EXISTS (SELECT 1 FROM public.auto_approval_policy
                    WHERE action_type = r.action_type
                      AND notes LIKE '%' || v_note_marker || '%')
    THEN
      UPDATE public.auto_approval_policy
         SET enabled = true,
             notes = COALESCE(notes,'') || ' [causal_auto_reenabled '
                     || to_char(now(),'YYYY-MM-DD')
                     || format(' lift=%s t=%s]', r.causal_lift_cents, ROUND(r.t_statistic,2)),
             updated_at = now()
       WHERE action_type = r.action_type;
      v_enabled := v_enabled + 1;

      INSERT INTO public.owner_notifications
        (tenant_id, kind, severity, title, body, link, channel, metadata, created_at)
      SELECT t.id,
             'policy_change',
             'info',
             format('Auto-re-enabled action: %s', r.action_type),
             format('Causal evidence now positive (lift=$%s, t=%s). Auto-approval resumed.',
                    ROUND(r.causal_lift_cents/100.0,2), ROUND(r.t_statistic,2)),
             '/brand/decisions',
             'in_app',
             jsonb_build_object('action_type', r.action_type,
                                'change', 'reenabled',
                                'causal_lift_cents', r.causal_lift_cents,
                                't_statistic', r.t_statistic),
             now()
        FROM public.tenants t
       WHERE t.status IN ('active','pending')
         AND COALESCE(t.is_pilot,false) = false;
    END IF;
  END LOOP;

  disabled_count := v_disabled;
  enabled_count := v_enabled;
  RETURN NEXT;
END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('causal_policy_enforcer'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('causal_policy_enforcer', '47 */6 * * *', $$ SELECT public.enforce_causal_policy(); $$);
