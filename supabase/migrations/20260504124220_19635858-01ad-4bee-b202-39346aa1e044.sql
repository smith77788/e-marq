-- Step 1: Open service_role read access on admin cron functions so we can inspect from this session
GRANT EXECUTE ON FUNCTION public.admin_list_cron_jobs() TO service_role, postgres, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cron_job_runs(text, integer) TO service_role, postgres, authenticated;

-- Helper: super-readable view (security definer) so we can SELECT it from supabase--read_query as service_role
CREATE OR REPLACE FUNCTION public._diag_cron_jobs()
RETURNS TABLE(jobname text, schedule text, command text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT jobname, schedule, command, active FROM cron.job ORDER BY jobname;
$$;

GRANT EXECUTE ON FUNCTION public._diag_cron_jobs() TO service_role, postgres, authenticated;
