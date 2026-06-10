SELECT cron.schedule(
  'dntrade-weekly-digest',
  '0 9 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/integrations/dntrade-weekly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_PUBLISHABLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);