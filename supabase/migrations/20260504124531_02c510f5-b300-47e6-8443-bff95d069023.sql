DO $$
DECLARE
  j RECORD;
  new_cmd text;
BEGIN
  FOR j IN
    SELECT jobname, command FROM cron.job
     WHERE jobname IN ('marq-agents-run-all-15min','marq-engines-dispatch-5min')
       AND command NOT ILIKE '%timeout_milliseconds%'
  LOOP
    -- Insert timeout right before the closing `)` of net.http_post(...)
    -- Match: `body := jsonb_build_object('tenant_id', t.id)\n  )`
    new_cmd := regexp_replace(
      j.command,
      '(body\s*:=\s*jsonb_build_object\([^)]*\))\s*\)',
      '\1, timeout_milliseconds := 30000)',
      'g'
    );
    IF new_cmd IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = j.jobname), command := new_cmd);
      RAISE NOTICE 'Updated %', j.jobname;
    END IF;
  END LOOP;
END$$;
