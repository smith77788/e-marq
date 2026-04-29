CREATE OR REPLACE FUNCTION public.admin_list_cron_jobs()
RETURNS TABLE (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  command text,
  last_run_started timestamptz,
  last_run_status text,
  runs_50 bigint,
  successes_50 bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_catalog
AS $$
BEGIN
  IF NOT (public.is_super_admin() OR auth.role() = 'service_role' OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    j.command,
    s.last_run_started,
    s.last_run_status,
    s.runs_50,
    s.successes_50
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT
      max(start_time) AS last_run_started,
      (array_agg(status ORDER BY start_time DESC))[1] AS last_run_status,
      count(*) AS runs_50,
      count(*) FILTER (WHERE status = 'succeeded') AS successes_50
    FROM (
      SELECT start_time, status
      FROM cron.job_run_details
      WHERE jobid = j.jobid
      ORDER BY start_time DESC
      LIMIT 50
    ) recent
  ) s ON true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_repair_cron_auth(new_token text)
RETURNS TABLE (
  jobid bigint,
  jobname text,
  changed boolean,
  new_command text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_catalog
AS $$
DECLARE
  rec record;
  updated text;
BEGIN
  IF NOT (public.is_super_admin() OR auth.role() = 'service_role' OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF new_token IS NULL OR length(new_token) < 16 THEN
    RAISE EXCEPTION 'new_token must be at least 16 chars';
  END IF;

  FOR rec IN
    SELECT j.jobid, j.jobname, j.schedule, j.command
    FROM cron.job j
    WHERE j.command ILIKE '%authorization%bearer%'
       OR j.command ILIKE '%"apikey"%'
  LOOP
    updated := regexp_replace(rec.command, 'Bearer\s+[A-Za-z0-9._\-]+', 'Bearer ' || new_token, 'gi');
    updated := regexp_replace(updated, '"apikey"\s*:\s*"[^"]+"', '"apikey": "' || new_token || '"', 'gi');
    IF updated IS DISTINCT FROM rec.command THEN
      PERFORM cron.alter_job(job_id := rec.jobid, command := updated);
      jobid := rec.jobid; jobname := rec.jobname; changed := true; new_command := left(updated, 200);
      RETURN NEXT;
    ELSE
      jobid := rec.jobid; jobname := rec.jobname; changed := false; new_command := left(rec.command, 200);
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
