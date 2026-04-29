CREATE OR REPLACE FUNCTION public.admin_cron_job_runs(p_jobname text, p_limit int DEFAULT 30)
RETURNS TABLE (
  out_runid bigint,
  out_status text,
  out_start_time timestamptz,
  out_end_time timestamptz,
  out_return_message text
)
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
  SELECT j.jobid INTO v_jobid FROM cron.job j WHERE j.jobname = p_jobname;
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'job not found: %', p_jobname; END IF;

  RETURN QUERY
  SELECT rd.runid, rd.status, rd.start_time, rd.end_time, left(rd.return_message, 300)
  FROM cron.job_run_details rd
  WHERE rd.jobid = v_jobid
  ORDER BY rd.start_time DESC
  LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_cron_job_runs(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cron_job_runs(text, int) TO authenticated;
