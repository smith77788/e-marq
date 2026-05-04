-- Add timeout_milliseconds := 30000 to every cron job that calls net.http_post but doesn't already specify a timeout.
-- Replace the closing of net.http_post(...) with `, timeout_milliseconds := 30000)`.
DO $$
DECLARE
  j RECORD;
  new_cmd text;
BEGIN
  FOR j IN
    SELECT jobname, command FROM cron.job
     WHERE command ILIKE '%net.http_post%'
       AND command NOT ILIKE '%timeout_milliseconds%'
  LOOP
    -- Inject timeout before the closing paren of net.http_post(...).
    -- We rely on the body argument always being the last argument and ending with `'::jsonb)` or similar.
    -- Use a tolerant regex: find the last `)` that closes net.http_post call, insert before it.
    -- Strategy: replace the last `body := ...::jsonb` followed by `)` with `body := ...::jsonb, timeout_milliseconds := 30000)`.
    new_cmd := regexp_replace(
      j.command,
      '(body\s*:=\s*[^)]+::jsonb)\s*\)',
      '\1, timeout_milliseconds := 30000)',
      'g'
    );
    IF new_cmd IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = j.jobname), command := new_cmd);
      RAISE NOTICE 'Updated %', j.jobname;
    ELSE
      RAISE NOTICE 'No regex match for %, skipped', j.jobname;
    END IF;
  END LOOP;
END$$;
