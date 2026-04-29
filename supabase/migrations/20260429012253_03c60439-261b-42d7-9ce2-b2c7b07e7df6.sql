-- 1. Fix high-impact mapping to match REAL AGENT_IDs registered in code
CREATE OR REPLACE FUNCTION public._high_impact_agent_for(_action_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _action_type
    WHEN 'price_adjust'        THEN 'price_optimizer'
    WHEN 'discount_dead_stock' THEN 'discount-elasticity'
    WHEN 'winback_outreach'    THEN 'email_winback'
    WHEN 'send_broadcast'      THEN 'broadcast-composer'
    ELSE NULL
  END
$$;

-- 2. agent_id -> URL slug (file-based routes use dashes)
CREATE OR REPLACE FUNCTION public._agent_slug_for(_agent_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _agent_id
    WHEN 'price_optimizer'      THEN 'price-optimizer'
    WHEN 'discount-elasticity'  THEN 'discount-elasticity'
    WHEN 'email_winback'        THEN 'email-winback'
    WHEN 'broadcast-composer'   THEN 'broadcast-composer'
    ELSE replace(_agent_id, '_', '-')
  END
$$;

-- 3. Add tracking column for net request IDs (idempotent)
ALTER TABLE public.ai_actions
  ADD COLUMN IF NOT EXISTS dispatch_request_id bigint,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

-- 4. Allow 'dispatched' status (extend check constraint)
ALTER TABLE public.ai_actions DROP CONSTRAINT IF EXISTS ai_actions_status_check;
ALTER TABLE public.ai_actions ADD CONSTRAINT ai_actions_status_check
  CHECK (status = ANY (ARRAY['pending','dispatched','applied','reverted','failed']));

-- 5. The runner — fan out pending ai_actions over HTTP via pg_net
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
  v_anon text;
  v_count int := 0;
  v_results jsonb := '[]'::jsonb;
  v_base_url text := 'https://e-marq.lovable.app';
BEGIN
  -- anon key fallback: read from app config; if missing, abort gracefully
  BEGIN
    v_anon := current_setting('app.anon_key', true);
  EXCEPTION WHEN OTHERS THEN
    v_anon := NULL;
  END;

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
        'apikey', COALESCE(v_anon, ''),
        'authorization', 'Bearer ' || COALESCE(v_anon, '')
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

-- 6. Reconciler — read net._http_response for dispatched actions, mark applied/failed
CREATE OR REPLACE FUNCTION public.reconcile_dispatched_ai_actions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  rec RECORD;
  v_status int;
  v_applied int := 0;
  v_failed int := 0;
  v_pending int := 0;
BEGIN
  FOR rec IN
    SELECT id, dispatch_request_id
    FROM ai_actions
    WHERE status = 'dispatched'
      AND dispatch_request_id IS NOT NULL
      AND dispatched_at < now() - interval '30 seconds'
      AND dispatched_at > now() - interval '24 hours'
    LIMIT 200
  LOOP
    SELECT status_code INTO v_status
    FROM net._http_response
    WHERE id = rec.dispatch_request_id;

    IF v_status IS NULL THEN
      v_pending := v_pending + 1;
      CONTINUE;
    END IF;

    IF v_status BETWEEN 200 AND 299 THEN
      UPDATE ai_actions
      SET status = 'applied', applied_at = now(),
          actual_result = jsonb_build_object('http_status', v_status, 'reconciled_at', now())
      WHERE id = rec.id;
      v_applied := v_applied + 1;
    ELSE
      UPDATE ai_actions
      SET status = 'failed',
          actual_result = jsonb_build_object('http_status', v_status, 'reconciled_at', now())
      WHERE id = rec.id;
      v_failed := v_failed + 1;

      -- bubble failure up to decision
      UPDATE decision_queue dq
      SET status = 'failed'
      WHERE dq.executor_action_id = rec.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'applied', v_applied,
    'failed', v_failed,
    'still_pending', v_pending
  );
END $$;

REVOKE ALL ON FUNCTION public.reconcile_dispatched_ai_actions() FROM anon, authenticated;

-- 7. Cron jobs
SELECT cron.schedule(
  'run-ai-actions-every-5min',
  '*/5 * * * *',
  $$ SELECT public.run_pending_ai_actions(50); $$
);

SELECT cron.schedule(
  'reconcile-ai-actions-every-5min',
  '2-59/5 * * * *',
  $$ SELECT public.reconcile_dispatched_ai_actions(); $$
);