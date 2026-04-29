CREATE OR REPLACE FUNCTION public.admin_list_cron_jobs()
RETURNS TABLE (
  out_jobid bigint,
  out_jobname text,
  out_schedule text,
  out_active boolean,
  out_command text,
  out_last_run_started timestamptz,
  out_last_run_status text,
  out_runs_50 bigint,
  out_successes_50 bigint
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
    s.runs,
    s.successes
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT
      max(rd.start_time) AS last_run_started,
      (array_agg(rd.status ORDER BY rd.start_time DESC))[1] AS last_run_status,
      count(*) AS runs,
      count(*) FILTER (WHERE rd.status = 'succeeded') AS successes
    FROM cron.job_run_details rd
    WHERE rd.jobid = j.jobid
  ) s ON true;
END;
$$;
