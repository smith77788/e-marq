SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname='self-heal-engine-tick'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/self-heal-engine',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
);