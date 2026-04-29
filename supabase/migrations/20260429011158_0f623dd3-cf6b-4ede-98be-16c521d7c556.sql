
CREATE OR REPLACE FUNCTION public.approve_decisions(_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid;
  _batch uuid := gen_random_uuid();
  _updated int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT DISTINCT tenant_id INTO _tenant
  FROM public.decision_queue WHERE id = ANY(_ids);

  IF _tenant IS NULL THEN
    RETURN jsonb_build_object('updated', 0);
  END IF;

  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'forbidden: not tenant admin';
  END IF;

  UPDATE public.decision_queue
     SET status        = 'approved'::decision_status,
         approved_by   = _uid,
         approved_at   = now(),
         batch_id      = _batch,
         updated_at    = now()
   WHERE id = ANY(_ids)
     AND tenant_id = _tenant
     AND status = 'pending';

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN jsonb_build_object('updated', _updated, 'batch_id', _batch);
END $$;

CREATE OR REPLACE FUNCTION public.reject_decisions(_ids uuid[], _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid;
  _updated int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT DISTINCT tenant_id INTO _tenant
  FROM public.decision_queue WHERE id = ANY(_ids);

  IF _tenant IS NULL THEN
    RETURN jsonb_build_object('updated', 0);
  END IF;

  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'forbidden: not tenant admin';
  END IF;

  UPDATE public.decision_queue
     SET status          = 'rejected'::decision_status,
         rejected_reason = _reason,
         approved_by     = _uid,
         approved_at     = now(),
         updated_at      = now()
   WHERE id = ANY(_ids)
     AND tenant_id = _tenant
     AND status IN ('pending','approved');

  GET DIAGNOSTICS _updated = ROW_COUNT;

  -- Also flip linked insights back to rejected
  UPDATE public.ai_insights
     SET status = 'rejected', updated_at = now()
   WHERE id IN (
     SELECT insight_id FROM public.decision_queue
      WHERE id = ANY(_ids) AND insight_id IS NOT NULL
   );

  RETURN jsonb_build_object('updated', _updated);
END $$;

CREATE OR REPLACE FUNCTION public.get_pending_decisions(_tenant uuid, _limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  agent_id text,
  action_type text,
  title text,
  rationale text,
  payload jsonb,
  confidence numeric,
  expected_impact jsonb,
  insight_type text,
  risk_level text,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_tenant_member(_tenant) THEN
    RAISE EXCEPTION 'forbidden: not tenant member';
  END IF;

  RETURN QUERY
  SELECT d.id, d.agent_id, d.action_type, d.title, d.rationale, d.payload,
         d.confidence, d.expected_impact,
         i.insight_type, i.risk_level,
         d.created_at, d.expires_at
    FROM public.decision_queue d
    LEFT JOIN public.ai_insights i ON i.id = d.insight_id
   WHERE d.tenant_id = _tenant
     AND d.status = 'pending'
   ORDER BY d.confidence DESC, d.created_at DESC
   LIMIT _limit;
END $$;

REVOKE EXECUTE ON FUNCTION public.approve_decisions(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_decisions(uuid[], text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_pending_decisions(uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_decisions(uuid[]) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.reject_decisions(uuid[], text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_pending_decisions(uuid, int) TO authenticated;
