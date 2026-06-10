
DO $$
DECLARE
  v_url text := 'https://project--fe3353ab-9ea3-4fcd-945e-8a76c46212c9.lovable.app/hooks/agents/self-heal-engine';
  v_anon text := '<SUPABASE_PUBLISHABLE_KEY>';
BEGIN
  -- Drop existing job(s)
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'self_heal_cycle_5min';

  PERFORM cron.schedule(
    'self_heal_cycle_5min',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization', %L
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cmd$, v_url, 'Bearer ' || v_anon)
  );
END $$;
