-- Fix critical ACOS loop bugs found during deep audit.
--
-- 1. get_acos_stats: referenced non-existent table "tenant_members" → "tenant_memberships"
-- 2. mark_decision_outcome: ai_memory INSERT used wrong columns (scope, key, value)
--    Real columns: pattern_key, agent, category, learned_rule, evidence, etc.
-- 3. auto_approval bootstrap: min_success_history=1 blocks new tenants (no history yet)
--    → set to 0 for low-risk action types so the loop actually starts
-- 4. Create missing dntrade_health_log table (referenced in code, no migration existed)

-- ============================================================
-- 1. Fix get_acos_stats: tenant_members → tenant_memberships
-- ============================================================
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
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships WHERE tenant_id = _tenant_id AND user_id = v_uid
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

-- ============================================================
-- 2. Fix mark_decision_outcome: correct ai_memory INSERT columns
--    Old code tried to INSERT (tenant_id, scope, key, value) but
--    ai_memory has (tenant_id, pattern_key, agent, category, ...).
--    Now we upsert properly so the learning loop actually works.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_decision_outcome(
  _decision_id uuid,
  _success boolean,
  _actual jsonb DEFAULT '{}'::jsonb,
  _attributed_revenue_cents bigint DEFAULT 0,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ao_id uuid;
  _baseline jsonb;
  _action_type text;
  _agent_id text;
  _tenant_id uuid;
BEGIN
  SELECT ao.id, ao.baseline, ao.action_type, ao.agent_id, ao.tenant_id
    INTO _ao_id, _baseline, _action_type, _agent_id, _tenant_id
  FROM public.action_outcomes ao
  WHERE ao.decision_id = _decision_id
  ORDER BY ao.measured_at DESC LIMIT 1;

  IF _ao_id IS NULL THEN RETURN; END IF;

  UPDATE public.action_outcomes
     SET actual = _actual,
         delta = COALESCE(_actual, '{}'::jsonb) - COALESCE(_baseline, '{}'::jsonb),
         attributed_revenue_cents = _attributed_revenue_cents,
         success = _success,
         notes = COALESCE(_notes, notes),
         measured_at = now()
   WHERE id = _ao_id;

  -- Write outcome into ai_memory for closed-loop learning.
  -- pattern_key = action_type::outcome so we accumulate stats per action type per tenant.
  BEGIN
    INSERT INTO public.ai_memory (
      tenant_id,
      pattern_key,
      agent,
      category,
      learned_rule,
      evidence,
      avg_impact,
      success_count,
      failure_count,
      confidence,
      last_observed_at
    ) VALUES (
      _tenant_id,
      _action_type || '::outcome',
      COALESCE(_agent_id, 'orchestrator'),
      'decision_outcome',
      'action ' || _action_type || ': ' || CASE WHEN _success THEN 'success' ELSE 'failure' END,
      jsonb_build_object(
        'success', _success,
        'attributed_revenue_cents', _attributed_revenue_cents,
        'agent_id', _agent_id,
        'decision_id', _decision_id::text
      ),
      CASE WHEN _success THEN 1.0 ELSE 0.0 END,
      CASE WHEN _success THEN 1 ELSE 0 END,
      CASE WHEN _success THEN 0 ELSE 1 END,
      CASE WHEN _success THEN 0.7 ELSE 0.3 END,
      now()
    )
    ON CONFLICT (tenant_id, pattern_key) DO UPDATE SET
      success_count    = ai_memory.success_count + EXCLUDED.success_count,
      failure_count    = ai_memory.failure_count + EXCLUDED.failure_count,
      avg_impact       = CASE
        WHEN (ai_memory.success_count + ai_memory.failure_count) = 0 THEN EXCLUDED.avg_impact
        ELSE (ai_memory.avg_impact * (ai_memory.success_count + ai_memory.failure_count)
              + EXCLUDED.avg_impact)
             / (ai_memory.success_count + ai_memory.failure_count + 1)
      END,
      confidence       = LEAST(0.95, GREATEST(0.1,
        (ai_memory.success_count + EXCLUDED.success_count)::numeric /
        NULLIF(ai_memory.success_count + ai_memory.failure_count
               + EXCLUDED.success_count + EXCLUDED.failure_count, 0)
      )),
      evidence         = EXCLUDED.evidence,
      last_observed_at = now(),
      updated_at       = now();
  EXCEPTION WHEN OTHERS THEN
    NULL; -- learning is best-effort, never block outcome recording
  END;
END $$;

REVOKE EXECUTE ON FUNCTION public.mark_decision_outcome(uuid, boolean, jsonb, bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_decision_outcome(uuid, boolean, jsonb, bigint, text) TO service_role, authenticated;

-- ============================================================
-- 3. Fix auto_approval bootstrap: new tenants have 0 success history,
--    so min_success_history=1 blocks all auto-approvals forever.
--    Set low-risk actions to min_success_history=0.
-- ============================================================
UPDATE public.auto_approval_policy
SET min_success_history = 0,
    notes               = notes || ' [bootstrap: 0 history required]',
    updated_at          = now()
WHERE action_type IN (
  'repeat_purchase_nudge',
  'cross_sell_recommend',
  'request_review',
  'request_ugc',
  'feature_product'
);

-- winback_outreach stays at 1 (has discount implications)
-- price_adjust and discount_dead_stock stay at 2 (pricing changes need track record)

-- ============================================================
-- 4. Create missing dntrade_health_log table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dntrade_health_log (
  id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id uuid        REFERENCES public.tenant_integrations(id) ON DELETE SET NULL,
  status         text        NOT NULL,
  http_status    integer     NOT NULL DEFAULT 0,
  ready          boolean     NOT NULL DEFAULT false,
  blockers       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  warnings       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  last_sync_status      text,
  last_sync_age_seconds numeric,
  checked_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dntrade_health_log_tenant ON public.dntrade_health_log (tenant_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_dntrade_health_log_integration ON public.dntrade_health_log (integration_id) WHERE integration_id IS NOT NULL;

ALTER TABLE public.dntrade_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dntrade_health_log_select_member_or_super"
  ON public.dntrade_health_log FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "dntrade_health_log_insert_service_only"
  ON public.dntrade_health_log FOR INSERT TO service_role
  WITH CHECK (true);

-- Run auto-approve now to unblock any existing pending decisions
SELECT public.auto_approve_eligible_decisions();
