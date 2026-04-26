
DO $$
DECLARE
  v_url text := 'https://e-marq.lovable.app/hooks/agents/self-heal-engine';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw';
BEGIN
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'self_heal_cycle_5min';

  PERFORM cron.schedule(
    'self_heal_cycle_5min',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization', %L),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cmd$, v_url, 'Bearer ' || v_anon)
  );
END $$;
