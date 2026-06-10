-- run-all: fan-out per tenant у самому cron
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname='marq-agents-run-all-15min'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/run-all',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
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
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
    body := jsonb_build_object('tenant_id', t.id)
  )
  FROM public.tenants t
  WHERE t.status IN ('active','pending');
  $cmd$
);