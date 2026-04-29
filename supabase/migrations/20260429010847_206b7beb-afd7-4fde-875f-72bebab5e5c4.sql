
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-signal-metrics-30min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-signal-metrics-30min',
  '*/30 * * * *',
  $cmd$ SELECT public.refresh_all_signal_metrics(); $cmd$
);
