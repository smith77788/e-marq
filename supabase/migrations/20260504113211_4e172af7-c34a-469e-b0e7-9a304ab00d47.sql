-- Rotate cron auth: replace anon JWT in pg_cron commands with CRON_SECRET bearer token.
-- CRON_SECRET is stored in Lovable Cloud secrets (used by the route handler via process.env.CRON_SECRET).
-- pg_cron has no access to those secrets, so the literal must be embedded in the cron command.
-- The runtime check (src/lib/acos/cronAuth.ts) compares against process.env.CRON_SECRET.
DO $$
DECLARE
  rec RECORD;
  old_token CONSTANT text := '<SUPABASE_PUBLISHABLE_KEY>';
  new_token CONSTANT text := '<CRON_SECRET>';
  new_cmd text;
  rotated int := 0;
BEGIN
  FOR rec IN SELECT jobid, jobname, command FROM cron.job WHERE command LIKE '%' || old_token || '%' LOOP
    new_cmd := replace(rec.command, old_token, new_token);
    PERFORM cron.alter_job(job_id := rec.jobid, command := new_cmd);
    rotated := rotated + 1;
    RAISE NOTICE 'Rotated cron job % (jobid=%)', rec.jobname, rec.jobid;
  END LOOP;
  RAISE NOTICE 'Total cron jobs rotated: %', rotated;
END $$;