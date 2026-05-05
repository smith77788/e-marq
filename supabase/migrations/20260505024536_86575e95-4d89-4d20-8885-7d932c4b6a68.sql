CREATE OR REPLACE FUNCTION public.archive_stale_decisions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.decision_queue
       SET status = 'expired',
           updated_at = now(),
           payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
             'archived_reason', 'auto_archived_stale',
             'archived_at', now(),
             'archived_after_days', 7
           )
     WHERE status = 'pending'
       AND created_at < now() - interval '7 days'
       AND action_type IN ('owner_setup_task','owner_review','owner_review_rules','flag_for_review')
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN jsonb_build_object('archived', v_count, 'at', now());
END;
$function$;