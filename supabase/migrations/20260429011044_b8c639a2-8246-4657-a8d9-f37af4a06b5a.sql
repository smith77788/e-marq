
-- Orchestrator: ai_insights → decision_queue

CREATE OR REPLACE FUNCTION public.propose_decisions_from_insights(_tenant uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ins record;
  _action_type text;
  _agent text;
  _conf numeric;
  _requires boolean;
  _created int := 0;
BEGIN
  FOR _ins IN
    SELECT i.*
    FROM public.ai_insights i
    WHERE i.tenant_id = _tenant
      AND i.status = 'new'
      AND NOT EXISTS (
        SELECT 1 FROM public.decision_queue d
        WHERE d.insight_id = i.id
          AND d.status NOT IN ('rejected','expired','failed')
      )
    ORDER BY i.created_at DESC
    LIMIT 100
  LOOP
    _action_type := CASE _ins.insight_type
      WHEN 'dead_stock'                 THEN 'discount_dead_stock'
      WHEN 'churn_risk'                 THEN 'winback_outreach'
      WHEN 'price_optimization'         THEN 'price_adjust'
      WHEN 'next_best_product'          THEN 'cross_sell_recommend'
      WHEN 'refund_risk_high'           THEN 'flag_for_review'
      WHEN 'second_order_gap'           THEN 'repeat_purchase_nudge'
      WHEN 'csat_request'               THEN 'request_review'
      WHEN 'social_proof_hidden_gem'    THEN 'feature_product'
      WHEN 'broadcast_suggestion'       THEN 'send_broadcast'
      WHEN 'ugc_low_volume'             THEN 'request_ugc'
      WHEN 'learning_loop_negative_rules' THEN 'owner_review_rules'
      ELSE
        CASE
          WHEN _ins.insight_type LIKE 'bootstrap_%' THEN 'owner_setup_task'
          WHEN _ins.insight_type LIKE 'setup_%'     THEN 'owner_setup_task'
          ELSE 'owner_review'
        END
    END;

    _agent := COALESCE(_ins.affected_layer, 'orchestrator');
    _conf  := COALESCE(_ins.confidence, 0.5);

    -- requires_approval: low conf, high risk, or anything touching price/discount/broadcast
    _requires := (
      _conf < 0.6
      OR _ins.risk_level IN ('high','critical')
      OR _action_type IN ('price_adjust','discount_dead_stock','send_broadcast','winback_outreach')
    );

    INSERT INTO public.decision_queue (
      tenant_id, insight_id, agent_id, action_type, title, rationale,
      payload, status, confidence, expected_impact, requires_approval,
      expires_at, created_at, updated_at
    ) VALUES (
      _tenant, _ins.id, _agent, _action_type,
      LEFT(COALESCE(_ins.title, _ins.insight_type), 200),
      _ins.description,
      COALESCE(_ins.metrics, '{}'::jsonb),
      CASE WHEN _requires THEN 'pending'::decision_status ELSE 'approved'::decision_status END,
      _conf,
      jsonb_build_object('summary', COALESCE(_ins.expected_impact, 'unknown'),
                         'risk_level', COALESCE(_ins.risk_level, 'low')),
      _requires,
      now() + interval '7 days',
      now(), now()
    );

    UPDATE public.ai_insights SET status = 'proposed', updated_at = now()
    WHERE id = _ins.id;

    _created := _created + 1;
  END LOOP;

  RETURN _created;
END $$;

CREATE OR REPLACE FUNCTION public.propose_decisions_all_tenants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _t record; _result jsonb := '[]'::jsonb; _n int;
BEGIN
  FOR _t IN SELECT id FROM public.tenants WHERE status IN ('active','pending') LOOP
    BEGIN
      _n := public.propose_decisions_from_insights(_t.id);
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'proposed', _n);
    EXCEPTION WHEN OTHERS THEN
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN _result;
END $$;

REVOKE EXECUTE ON FUNCTION public.propose_decisions_from_insights(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.propose_decisions_all_tenants() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.propose_decisions_from_insights(uuid) TO service_role, authenticated;
GRANT  EXECUTE ON FUNCTION public.propose_decisions_all_tenants() TO service_role;

-- Schedule it
DO $$ BEGIN
  PERFORM cron.unschedule('propose-decisions-every-15min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'propose-decisions-every-15min',
  '*/15 * * * *',
  $cmd$ SELECT public.propose_decisions_all_tenants(); $cmd$
);
