
-- Add dismiss support and cron schedule for Self-Heal Engine

-- 1) Helper RPC to dismiss an incident (super-admin only via RLS on table; this just wraps update)
CREATE OR REPLACE FUNCTION public.self_heal_dismiss_incident(p_incident_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super-admin required';
  END IF;
  UPDATE public.self_heal_incidents
     SET status = 'dismissed',
         resolved_at = now(),
         root_cause = COALESCE(p_reason, root_cause)
   WHERE id = p_incident_id;
END;
$$;

-- 2) Helper RPC to dismiss a pending action (mark as 'skipped' permanently with note)
CREATE OR REPLACE FUNCTION public.self_heal_dismiss_action(p_action_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super-admin required';
  END IF;
  UPDATE public.self_heal_actions
     SET status = 'skipped',
         result_text = COALESCE('dismissed: ' || p_reason, 'dismissed by admin'),
         applied_at = now()
   WHERE id = p_action_id
     AND status NOT IN ('applied','reverted');
END;
$$;

-- 3) Schedule self-heal cycle every 5 minutes via pg_cron
DO $$
DECLARE
  v_url text;
BEGIN
  -- Remove existing job if any
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'self_heal_cycle_5min';

  v_url := 'https://project--fe3353ab-9ea3-4fcd-945e-8a76c46212c9.lovable.app/hooks/agents/self-heal-engine';

  PERFORM cron.schedule(
    'self_heal_cycle_5min',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || current_setting('app.cron_token', true)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cmd$, v_url)
  );
END $$;
