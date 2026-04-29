CREATE OR REPLACE FUNCTION public.archive_stale_outreach_actions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.outreach_actions
  SET status = 'skipped',
      updated_at = now()
  WHERE status = 'pending_review'
    AND created_at < now() - interval '3 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT public.admin_set_cron_job_command(
  'marq-outreach-action-executor-15min',
  $cmd$
  DO $outer$
  DECLARE v_pending int;
  BEGIN
    SELECT count(*) INTO v_pending FROM public.outreach_actions WHERE status IN ('approved','draft');
    IF v_pending > 0 THEN
      PERFORM net.http_post(
        url := 'https://e-marq.lovable.app/hooks/agents/outreach-action-executor',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
        body := '{}'::jsonb
      );
    END IF;
    PERFORM public.archive_stale_outreach_actions();
  END $outer$;
  $cmd$
);

SELECT public.admin_set_cron_job_command(
  'marq-tg-user-action-executor-10min',
  $cmd$
  DO $outer$
  DECLARE v_pending int;
  BEGIN
    SELECT count(*) INTO v_pending FROM public.tg_user_actions WHERE status::text IN ('approved','queued','pending');
    IF v_pending > 0 THEN
      PERFORM net.http_post(
        url := 'https://e-marq.lovable.app/hooks/agents/tg-user-action-executor',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
        body := '{}'::jsonb
      );
    END IF;
  END $outer$;
  $cmd$
);

SELECT public.archive_stale_outreach_actions() AS archived;