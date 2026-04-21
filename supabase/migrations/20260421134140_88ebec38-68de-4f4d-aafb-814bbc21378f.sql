SELECT cron.schedule(
  'dntrade-weekly-digest',
  '0 9 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/integrations/dntrade-weekly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjI5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw'
    ),
    body := '{}'::jsonb
  );
  $$
);