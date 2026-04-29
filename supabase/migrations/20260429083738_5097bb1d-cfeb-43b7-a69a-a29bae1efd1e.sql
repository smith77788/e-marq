
CREATE OR REPLACE FUNCTION public.get_acos_stats(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  -- Authz: каллер має бути членом тенанта АБО admin
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_members WHERE tenant_id = _tenant_id AND user_id = v_uid
  ) AND NOT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = v_uid AND role IN ('admin','super_admin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH done_24h AS (
    SELECT COUNT(*) c FROM decision_queue
    WHERE tenant_id = _tenant_id AND status='done' AND executed_at > now() - interval '24h'
  ),
  done_7d AS (
    SELECT COUNT(*) c FROM decision_queue
    WHERE tenant_id = _tenant_id AND status='done' AND executed_at > now() - interval '7d'
  ),
  done_30d AS (
    SELECT COUNT(*) c FROM decision_queue
    WHERE tenant_id = _tenant_id AND status='done' AND executed_at > now() - interval '30d'
  ),
  done_total AS (
    SELECT COUNT(*) c FROM decision_queue
    WHERE tenant_id = _tenant_id AND status='done'
  ),
  approval_split AS (
    SELECT
      COUNT(*) FILTER (WHERE payload->>'approval_mode' IN ('history','bootstrap')) as auto_count,
      COUNT(*) FILTER (WHERE payload->>'approval_mode' IS NULL) as manual_count
    FROM decision_queue
    WHERE tenant_id = _tenant_id AND status='done'
  ),
  outcomes_summary AS (
    SELECT
      COUNT(*) as measured,
      COUNT(*) FILTER (WHERE success=true) as wins,
      COUNT(*) FILTER (WHERE success=false) as losses,
      COALESCE(SUM(attributed_revenue_cents), 0) as revenue_cents_total,
      COALESCE(SUM(attributed_revenue_cents) FILTER (WHERE measured_at > now() - interval '30d'), 0) as revenue_cents_30d
    FROM action_outcomes
    WHERE tenant_id = _tenant_id
  ),
  by_type AS (
    SELECT action_type, COUNT(*) as cnt
    FROM decision_queue
    WHERE tenant_id = _tenant_id AND status='done' AND executed_at > now() - interval '30d'
    GROUP BY action_type
    ORDER BY cnt DESC
    LIMIT 10
  ),
  pending_inbox AS (
    SELECT COUNT(*) c FROM decision_queue
    WHERE tenant_id = _tenant_id AND status='pending'
  )
  SELECT jsonb_build_object(
    'ok', true,
    'done', jsonb_build_object(
      'h24', (SELECT c FROM done_24h),
      'd7', (SELECT c FROM done_7d),
      'd30', (SELECT c FROM done_30d),
      'all', (SELECT c FROM done_total)
    ),
    'approval_split', (SELECT row_to_json(approval_split) FROM approval_split),
    'outcomes', (SELECT row_to_json(outcomes_summary) FROM outcomes_summary),
    'by_type', (SELECT COALESCE(json_agg(by_type), '[]'::json) FROM by_type),
    'pending_inbox', (SELECT c FROM pending_inbox),
    'as_of', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_acos_stats(uuid) TO authenticated;
