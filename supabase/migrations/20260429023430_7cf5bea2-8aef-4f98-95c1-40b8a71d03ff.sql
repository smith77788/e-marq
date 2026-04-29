-- 1) Backfill requires_owner для існуючих manual-actions
UPDATE public.decision_queue
   SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{requires_owner}', 'true'::jsonb, true),
       requires_approval = true,
       updated_at = now()
 WHERE status = 'pending'
   AND action_type IN ('owner_setup_task','owner_review','owner_review_rules','flag_for_review')
   AND COALESCE((payload->>'requires_owner')::bool, false) = false;

-- 2) Add attempts counter (default 1 — current row had one try)
ALTER TABLE public.owner_telegram_outbox
  ADD COLUMN IF NOT EXISTS attempts smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

-- 3) Retry function: requeue transient failures (429/502/503/504/timeouts)
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
  -- Requeue transient errors with attempts < 5
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
       SET status        = 'queued',
           error         = NULL,
           attempts      = o.attempts + 1,
           next_retry_at = now() + (interval '1 minute' * power(2, o.attempts))  -- 2,4,8,16,32 min
      FROM transient t
     WHERE o.id = t.id
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_requeued FROM upd;

  -- Drop permanently-failed rows (>=5 attempts) — but keep them for debugging
  -- Actually, just count them
  SELECT COUNT(*) INTO v_dropped
    FROM public.owner_telegram_outbox
   WHERE status = 'failed' AND attempts >= 5;

  requeued := v_requeued;
  dropped  := v_dropped;
  RETURN NEXT;
END;
$function$;