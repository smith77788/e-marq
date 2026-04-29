CREATE OR REPLACE FUNCTION public.admin_set_cron_job_command(p_jobname text, p_command text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_catalog
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  IF NOT (public.is_super_admin() OR auth.role() = 'service_role' OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_jobname IS NULL OR p_command IS NULL THEN
    RAISE EXCEPTION 'p_jobname and p_command required';
  END IF;
  SELECT j.jobid INTO v_jobid FROM cron.job j WHERE j.jobname = p_jobname;
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'cron job % not found', p_jobname;
  END IF;
  PERFORM cron.alter_job(job_id := v_jobid, command := p_command);
  RETURN v_jobid;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_cron_job_command(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_cron_job_command(text, text) TO authenticated;

-- Apply: fix agents-tick-every-minute by adding the Bearer header.
SELECT public.admin_set_cron_job_command(
  'agents-tick-every-minute',
  $cmd$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw'
    ),
    body := '{}'::jsonb
  );
  $cmd$
);
