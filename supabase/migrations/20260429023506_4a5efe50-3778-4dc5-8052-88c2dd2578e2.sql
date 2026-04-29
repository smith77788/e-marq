CREATE OR REPLACE FUNCTION public.retry_failed_telegram_outbox()
RETURNS TABLE(requeued integer, dropped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_requeued int := 0;
  v_dropped  int := 0;
BEGIN
  WITH transient AS (
    SELECT id
      FROM public.owner_telegram_outbox
     WHERE status = 'failed'
       AND attempts < 5
       AND (
         error ILIKE '%Too Many Requests%' OR
         error ILIKE '%HTTP 50%' OR
         error ILIKE '%timeout%' OR
         error ILIKE '%temporar%'
       )
       AND (next_retry_at IS NULL OR next_retry_at <= now())
     LIMIT 200
  ), upd AS (
    UPDATE public.owner_telegram_outbox o
       SET status        = 'pending',
           error         = NULL,
           attempts      = o.attempts + 1,
           next_retry_at = now() + (interval '1 minute' * power(2, o.attempts))
      FROM transient t
     WHERE o.id = t.id
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_requeued FROM upd;

  SELECT COUNT(*) INTO v_dropped
    FROM public.owner_telegram_outbox
   WHERE status = 'failed' AND attempts >= 5;

  requeued := v_requeued;
  dropped  := v_dropped;
  RETURN NEXT;
END;
$function$;

SELECT * FROM public.retry_failed_telegram_outbox();

SELECT cron.schedule(
  'tg-outbox-retry-10min',
  '*/10 * * * *',
  $$ SELECT public.retry_failed_telegram_outbox(); $$
);