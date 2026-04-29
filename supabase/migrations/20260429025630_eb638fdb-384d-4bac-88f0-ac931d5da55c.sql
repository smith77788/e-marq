-- Approve a decision (manual owner action)
CREATE OR REPLACE FUNCTION public.owner_approve_decision(_decision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;

  SELECT tenant_id, status::text INTO v_tenant, v_status
    FROM decision_queue WHERE id = _decision_id;
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;

  -- Check user belongs to tenant
  IF NOT EXISTS (
    SELECT 1 FROM tenant_members WHERE tenant_id = v_tenant AND user_id = v_uid
  ) AND NOT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = v_uid AND role IN ('admin','super_admin')
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok',false,'error','not_pending','status',v_status);
  END IF;

  UPDATE decision_queue
     SET status = 'approved',
         approved_by = v_uid,
         approved_at = now(),
         approved_by_auto = false,
         updated_at = now()
   WHERE id = _decision_id AND status = 'pending';

  RETURN jsonb_build_object('ok',true,'status','approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_reject_decision(_decision_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;

  SELECT tenant_id, status::text INTO v_tenant, v_status
    FROM decision_queue WHERE id = _decision_id;
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_members WHERE tenant_id = v_tenant AND user_id = v_uid
  ) AND NOT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = v_uid AND role IN ('admin','super_admin')
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok',false,'error','not_pending','status',v_status);
  END IF;

  UPDATE decision_queue
     SET status = 'rejected',
         rejected_reason = _reason,
         updated_at = now()
   WHERE id = _decision_id AND status = 'pending';

  RETURN jsonb_build_object('ok',true,'status','rejected');
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_approve_decision(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_reject_decision(uuid, text) TO authenticated;