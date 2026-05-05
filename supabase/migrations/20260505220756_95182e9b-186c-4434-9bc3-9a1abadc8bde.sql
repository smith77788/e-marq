
-- =========================================================
-- Auto-Resume Policy on Recovery (SQL Agent #18)
-- =========================================================
CREATE OR REPLACE FUNCTION public.auto_resume_policies_on_recovery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resumed int := 0;
  v_skipped int := 0;
  r record;
  v_n int;
  v_wins int;
  v_winrate numeric;
  v_avg_rev numeric;
  v_recent_notif int;
BEGIN
  FOR r IN
    SELECT action_type, notes
    FROM public.auto_approval_policy
    WHERE enabled = false
      AND notes IS NOT NULL
      AND notes ILIKE '%auto-paused%'
  LOOP
    -- Skip if recently auto-resumed (7d dedup)
    SELECT COUNT(*) INTO v_recent_notif
    FROM public.owner_notifications
    WHERE kind = 'auto_resumed_policy'
      AND payload->>'action_type' = r.action_type
      AND created_at > now() - interval '7 days';

    IF v_recent_notif > 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Aggregate last 14d outcomes for this action_type across tenants
    SELECT
      COUNT(*) FILTER (WHERE measured_at IS NOT NULL),
      COUNT(*) FILTER (WHERE success = true),
      AVG(COALESCE(attributed_revenue_cents, 0))
    INTO v_n, v_wins, v_avg_rev
    FROM public.action_outcomes
    WHERE action_type = r.action_type
      AND measured_at > now() - interval '14 days';

    IF COALESCE(v_n, 0) < 5 THEN
      CONTINUE;
    END IF;

    v_winrate := v_wins::numeric / NULLIF(v_n, 0);

    IF v_winrate >= 0.50 AND COALESCE(v_avg_rev, 0) > 0 THEN
      UPDATE public.auto_approval_policy
      SET enabled = true,
          notes = COALESCE(notes, '') || E'\n' || format(
            'auto-resumed %s: win=%s%% n=%s avg_rev=%s',
            to_char(now(), 'YYYY-MM-DD'),
            round(v_winrate * 100),
            v_n,
            round(v_avg_rev)
          ),
          updated_at = now()
      WHERE action_type = r.action_type;

      INSERT INTO public.owner_notifications (
        tenant_id, kind, severity, title, body, payload, channel
      ) VALUES (
        NULL,
        'auto_resumed_policy',
        'info',
        format('Policy "%s" знову активна', r.action_type),
        format('Win-rate за 14 днів = %s%% (n=%s). Auto-approval відновлено.',
               round(v_winrate * 100), v_n),
        jsonb_build_object(
          'action_type', r.action_type,
          'win_rate', v_winrate,
          'n', v_n,
          'avg_attributed_revenue_cents', round(v_avg_rev)
        ),
        'telegram'
      );

      v_resumed := v_resumed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'resumed', v_resumed,
    'skipped_dedup', v_skipped,
    'ran_at', now()
  );
END;
$$;

-- Schedule daily at 06:45 UTC (right after action-quality-monitor 06:15 + auto-pause 06:30)
DO $$
BEGIN
  PERFORM cron.unschedule('auto-resume-policy-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-resume-policy-daily',
  '45 6 * * *',
  $$ SELECT public.auto_resume_policies_on_recovery(); $$
);

-- =========================================================
-- upsert_acquisition_cost RPC (Marketing Spend UI)
-- =========================================================
CREATE OR REPLACE FUNCTION public.upsert_acquisition_cost(
  p_tenant_id uuid,
  p_period_month date,
  p_channel text,
  p_spend_cents bigint,
  p_new_customers integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT role INTO v_role
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'permission denied: tenant owner/admin required';
  END IF;

  IF p_channel IS NULL OR length(trim(p_channel)) = 0 THEN
    RAISE EXCEPTION 'channel is required';
  END IF;

  INSERT INTO public.acquisition_costs (
    tenant_id, period_month, channel, spend_cents, new_customers
  ) VALUES (
    p_tenant_id,
    date_trunc('month', p_period_month)::date,
    trim(p_channel),
    GREATEST(0, COALESCE(p_spend_cents, 0)),
    GREATEST(0, COALESCE(p_new_customers, 0))
  )
  ON CONFLICT (tenant_id, period_month, channel)
  DO UPDATE SET
    spend_cents = EXCLUDED.spend_cents,
    new_customers = EXCLUDED.new_customers,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_acquisition_cost(uuid, date, text, bigint, integer) TO authenticated;
