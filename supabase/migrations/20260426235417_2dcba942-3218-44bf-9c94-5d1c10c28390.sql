
DO $$
DECLARE
  v_url text := 'https://e-marq.lovable.app/hooks/agents/self-heal-engine';
  v_anon text := '<SUPABASE_PUBLISHABLE_KEY>';
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
