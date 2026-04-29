
CREATE OR REPLACE FUNCTION public.owner_bulk_reject_decisions(
  _tenant_id uuid,
  _action_type text,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_members WHERE tenant_id = _tenant_id AND user_id = v_uid
  ) AND NOT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = v_uid AND role IN ('admin','super_admin')
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;

  WITH upd AS (
    UPDATE decision_queue
       SET status = 'rejected',
           rejected_reason = COALESCE(_reason, 'bulk_dismiss'),
           updated_at = now()
     WHERE tenant_id = _tenant_id
       AND action_type = _action_type
       AND status = 'pending'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.owner_bulk_reject_decisions(uuid, text, text) TO authenticated;
