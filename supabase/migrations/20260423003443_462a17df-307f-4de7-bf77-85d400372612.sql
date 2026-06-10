SELECT cron.unschedule('acos-winback-all');

SELECT cron.schedule(
  'acos-winback-all',
  '0 10 * * 1',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/engines/winback-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
    body := '{}'::jsonb
  );$$
);