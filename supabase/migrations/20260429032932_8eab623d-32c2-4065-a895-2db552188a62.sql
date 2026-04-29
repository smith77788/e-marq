-- Hourly demo measurement to close learning loop faster for pilot tenant.
-- Idempotent: drop existing schedule if any, then re-create.
DO $$
BEGIN
  PERFORM cron.unschedule('demo-measure-outcomes-hourly') 
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='demo-measure-outcomes-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'demo-measure-outcomes-hourly',
  '23 * * * *',
  $$SELECT public.demo_measure_recent_outcomes();$$
);