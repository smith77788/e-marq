-- Rotate cron auth: replace anon JWT in pg_cron commands with CRON_SECRET bearer token.
-- CRON_SECRET is stored in Lovable Cloud secrets (used by the route handler via process.env.CRON_SECRET).
-- pg_cron has no access to those secrets, so the literal must be embedded in the cron command.
-- The runtime check (src/lib/acos/cronAuth.ts) compares against process.env.CRON_SECRET.
DO $$
DECLARE
  rec RECORD;
  old_token CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw';
  new_token CONSTANT text := 'mwmiGnvR5F4PIhHzFPg3wNd67fERqhBX9BtK68ErdEHVTMM8ssYqX_rII5c3hneY';
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