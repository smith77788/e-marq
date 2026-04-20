-- Schedule abandoned cart engine every 15 minutes
SELECT cron.schedule(
  'acos-abandoned-cart-all',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://id-preview--fe3353ab-9ea3-4fcd-945e-8a76c46212c9.lovable.app/hooks/engines/abandoned-cart-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw","Lovable-Context":"cron"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Schedule winback engine weekly (Mondays 10:00 UTC)
SELECT cron.schedule(
  'acos-winback-all',
  '0 10 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://id-preview--fe3353ab-9ea3-4fcd-945e-8a76c46212c9.lovable.app/hooks/engines/winback-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw","Lovable-Context":"cron"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
