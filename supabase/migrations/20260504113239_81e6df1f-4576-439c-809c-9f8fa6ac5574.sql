DO $$
DECLARE
  rec RECORD;
  new_token CONSTANT text := 'mwmiGnvR5F4PIhHzFPg3wNd67fERqhBX9BtK68ErdEHVTMM8ssYqX_rII5c3hneY';
BEGIN
  FOR rec IN SELECT jobid, jobname, command FROM cron.job WHERE jobname = 'dntrade-weekly-digest' LOOP
    PERFORM cron.alter_job(
      job_id := rec.jobid,
      command := regexp_replace(
        rec.command,
        'Bearer eyJ[A-Za-z0-9_\.\-]+',
        'Bearer ' || new_token,
        'g'
      )
    );
    RAISE NOTICE 'Rotated %', rec.jobname;
  END LOOP;
END $$;