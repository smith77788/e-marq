SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname='self-heal-engine-tick'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/self-heal-engine',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
);