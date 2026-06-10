-- Backfill mismatched agent_id
UPDATE ai_actions
SET agent_id = CASE agent_id
  WHEN 'price-optimizer' THEN 'price_optimizer'
  WHEN 'email-winback' THEN 'email_winback'
  ELSE agent_id
END
WHERE agent_id IN ('price-optimizer','email-winback')
  AND status = 'pending';

-- Replace runner with inlined anon key
CREATE OR REPLACE FUNCTION public.run_pending_ai_actions(_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_slug text;
  v_url text;
  v_req_id bigint;
  v_count int := 0;
  v_results jsonb := '[]'::jsonb;
  v_base_url text := 'https://e-marq.lovable.app';
  v_anon text := '<SUPABASE_PUBLISHABLE_KEY>';
BEGIN
  FOR rec IN
    SELECT id, tenant_id, agent_id, action_type, parameters, source_insight_id
    FROM ai_actions
    WHERE status = 'pending'
      AND agent_id IN ('price_optimizer','discount-elasticity','email_winback','broadcast-composer')
    ORDER BY created_at
    LIMIT _limit
  LOOP
    v_slug := _agent_slug_for(rec.agent_id);
    v_url := v_base_url || '/hooks/agents/' || v_slug;

    SELECT net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', v_anon,
        'authorization', 'Bearer ' || v_anon
      ),
      body := jsonb_build_object(
        'tenant_id', rec.tenant_id,
        'decision_id', rec.parameters->>'decision_id',
        'action_id', rec.id,
        'source_insight_id', rec.source_insight_id,
        'parameters', rec.parameters
      ),
      timeout_milliseconds := 30000
    ) INTO v_req_id;

    UPDATE ai_actions
    SET status = 'dispatched',
        dispatch_request_id = v_req_id,
        dispatched_at = now()
    WHERE id = rec.id;

    v_count := v_count + 1;
    v_results := v_results || jsonb_build_object(
      'action_id', rec.id,
      'agent', rec.agent_id,
      'url', v_url,
      'request_id', v_req_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'dispatched', v_count,
    'items', v_results
  );
END $$;

REVOKE ALL ON FUNCTION public.run_pending_ai_actions(int) FROM anon, authenticated;

-- Smoke run
DO $$
DECLARE r jsonb;
BEGIN
  SELECT public.run_pending_ai_actions(10) INTO r;
  RAISE NOTICE 'runner result: %', r;
END $$;