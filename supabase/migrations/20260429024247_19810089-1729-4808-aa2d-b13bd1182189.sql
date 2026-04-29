-- run-all: fan-out per tenant у самому cron
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname='marq-agents-run-all-15min'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/run-all',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := jsonb_build_object('tenant_id', t.id)
  )
  FROM public.tenants t
  WHERE t.status IN ('active','pending');
  $cmd$
);

-- engines/dispatch: те саме
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname='marq-engines-dispatch-5min'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/engines/dispatch',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := jsonb_build_object('tenant_id', t.id)
  )
  FROM public.tenants t
  WHERE t.status IN ('active','pending');
  $cmd$
);