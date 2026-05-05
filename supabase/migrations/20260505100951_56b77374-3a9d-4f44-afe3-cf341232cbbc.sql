
-- SQL Agent #17: Auto-Pause Policy on Quality Drop
-- Closes the loop: when action_quality_drop insights for the same action_type
-- fire in 2+ distinct ISO weeks within last 28d, automatically disable that
-- action_type in auto_approval_policy and notify owner(s).

CREATE OR REPLACE FUNCTION public.auto_pause_policies_on_quality_drop()
RETURNS TABLE(action_type text, weeks_dropped integer, disabled boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_disabled boolean;
  v_existing_kind text;
BEGIN
  FOR r IN
    SELECT
      (i.metrics->>'action_type')::text AS action_type,
      COUNT(DISTINCT date_trunc('week', i.created_at))::int AS weeks,
      COUNT(DISTINCT i.tenant_id)::int AS tenants_affected,
      MIN(i.created_at) AS first_seen,
      MAX(i.created_at) AS last_seen
    FROM public.ai_insights i
    WHERE i.insight_type = 'action_quality_drop'
      AND i.created_at > now() - interval '28 days'
      AND i.metrics ? 'action_type'
    GROUP BY (i.metrics->>'action_type')
    HAVING COUNT(DISTINCT date_trunc('week', i.created_at)) >= 2
  LOOP
    v_disabled := false;

    -- Disable in policy if currently enabled
    UPDATE public.auto_approval_policy p
       SET enabled = false,
           notes = COALESCE(p.notes,'') ||
                   E'\n[auto-paused ' || to_char(now(),'YYYY-MM-DD') ||
                   '] quality_drop in ' || r.weeks || ' weeks across ' ||
                   r.tenants_affected || ' tenants',
           updated_at = now()
     WHERE p.action_type = r.action_type
       AND p.enabled = true
    RETURNING true INTO v_disabled;

    IF v_disabled THEN
      -- Owner notification (super_admin scope: tenant_id = NULL, severity high)
      INSERT INTO public.owner_notifications (
        tenant_id, kind, severity, channel, title, body, metadata, status
      )
      SELECT
        NULL,
        'auto_paused_policy',
        'high',
        'telegram',
        '⏸ Auto-pause: ' || r.action_type,
        'Action ' || r.action_type || ' автоматично призупинено (auto-approval=false). ' ||
        'Quality_drop фіксувався у ' || r.weeks || ' тижнів поспіль за ' ||
        r.tenants_affected || ' тенантами. Переглянь правила перш ніж вмикати знову.',
        jsonb_build_object(
          'action_type', r.action_type,
          'weeks_dropped', r.weeks,
          'tenants_affected', r.tenants_affected,
          'first_seen', r.first_seen,
          'last_seen', r.last_seen,
          'auto_paused_at', now()
        ),
        'pending'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.owner_notifications n
        WHERE n.kind = 'auto_paused_policy'
          AND n.metadata->>'action_type' = r.action_type
          AND n.created_at > now() - interval '7 days'
      );
    END IF;

    action_type := r.action_type;
    weeks_dropped := r.weeks;
    disabled := COALESCE(v_disabled, false);
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

-- Schedule daily at 06:30 UTC (right after action-quality-monitor at 06:15)
SELECT cron.unschedule('auto-pause-policy-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-pause-policy-daily'
);

SELECT cron.schedule(
  'auto-pause-policy-daily',
  '30 6 * * *',
  $$ SELECT public.auto_pause_policies_on_quality_drop(); $$
);
