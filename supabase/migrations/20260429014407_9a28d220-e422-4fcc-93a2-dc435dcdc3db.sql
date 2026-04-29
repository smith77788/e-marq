
CREATE OR REPLACE FUNCTION public.unstick_executing_decisions()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.decision_queue
     SET status = 'done',
         executed_at = COALESCE(executed_at, now()),
         updated_at  = now()
   WHERE status = 'executing'
     AND executed_at IS NOT NULL
     AND updated_at < now() - interval '15 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT cron.unschedule('unstick-executing-15min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'unstick-executing-15min');

SELECT cron.schedule(
  'unstick-executing-15min',
  '*/15 * * * *',
  $$ SELECT public.unstick_executing_decisions(); $$
);

SELECT public.unstick_executing_decisions();
