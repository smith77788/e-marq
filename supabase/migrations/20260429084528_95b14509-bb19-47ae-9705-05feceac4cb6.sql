
-- Phase 14: Outcome Forecasting Layer
-- Adds expected_revenue_cents + confidence to every new decision based on
-- historical action_outcomes (per tenant, per action_type) with global prior fallback.

CREATE OR REPLACE FUNCTION public._forecast_for_action(_tenant_id uuid, _action_type text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_n int := 0;
  v_tenant_avg numeric := 0;
  v_tenant_winrate numeric := 0;
  v_global_n int := 0;
  v_global_avg numeric := 0;
  v_global_winrate numeric := 0;
  v_expected bigint := 0;
  v_confidence numeric := 0.3;
  v_basis text := 'prior';
BEGIN
  -- tenant-specific history
  SELECT COUNT(*),
         COALESCE(AVG(COALESCE(attributed_revenue_cents,0)),0),
         COALESCE(AVG(CASE WHEN COALESCE(attributed_revenue_cents,0) > 0 THEN 1.0 ELSE 0.0 END),0)
    INTO v_tenant_n, v_tenant_avg, v_tenant_winrate
  FROM action_outcomes ao
  JOIN decision_queue d ON d.id = ao.decision_id
  WHERE d.tenant_id = _tenant_id
    AND d.action_type = _action_type
    AND ao.measured_at IS NOT NULL;

  -- global history (across all tenants) for prior
  SELECT COUNT(*),
         COALESCE(AVG(COALESCE(attributed_revenue_cents,0)),0),
         COALESCE(AVG(CASE WHEN COALESCE(attributed_revenue_cents,0) > 0 THEN 1.0 ELSE 0.0 END),0)
    INTO v_global_n, v_global_avg, v_global_winrate
  FROM action_outcomes ao
  JOIN decision_queue d ON d.id = ao.decision_id
  WHERE d.action_type = _action_type
    AND ao.measured_at IS NOT NULL;

  IF v_tenant_n >= 5 THEN
    v_expected := round(v_tenant_avg)::bigint;
    v_confidence := LEAST(0.95, 0.4 + (v_tenant_n::numeric / 50.0));
    v_basis := 'tenant_history';
  ELSIF v_tenant_n > 0 AND v_global_n > 0 THEN
    -- weighted blend: tenant data + global prior
    v_expected := round((v_tenant_avg * v_tenant_n + v_global_avg * 5) / (v_tenant_n + 5))::bigint;
    v_confidence := 0.4 + (v_tenant_n::numeric / 30.0);
    v_basis := 'blended';
  ELSIF v_global_n >= 3 THEN
    v_expected := round(v_global_avg)::bigint;
    v_confidence := 0.35;
    v_basis := 'global_prior';
  ELSE
    -- bootstrap heuristic priors per known action_type
    v_expected := CASE _action_type
      WHEN 'cross_sell_recommend' THEN 250000
      WHEN 'repeat_purchase_nudge' THEN 180000
      WHEN 'winback_outreach' THEN 320000
      WHEN 'discount_dead_stock' THEN 150000
      WHEN 'feature_product' THEN 200000
      WHEN 'request_review' THEN 50000
      WHEN 'request_ugc' THEN 80000
      WHEN 'price_adjust' THEN 220000
      ELSE 0
    END;
    v_confidence := 0.25;
    v_basis := 'heuristic';
  END IF;

  RETURN jsonb_build_object(
    'expected_revenue_cents', v_expected,
    'confidence', round(v_confidence, 2),
    'basis', v_basis,
    'tenant_samples', v_tenant_n,
    'global_samples', v_global_n,
    'tenant_winrate', round(v_tenant_winrate, 3),
    'global_winrate', round(v_global_winrate, 3),
    'computed_at', now()
  );
END;
$$;

-- Backfill forecasts for all open decisions (pending/approved) without one
CREATE OR REPLACE FUNCTION public.backfill_decision_forecasts()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int := 0;
  r RECORD;
  v_forecast jsonb;
BEGIN
  FOR r IN
    SELECT id, tenant_id, action_type, payload
    FROM decision_queue
    WHERE status IN ('pending','approved')
      AND (payload->'forecast') IS NULL
    LIMIT 500
  LOOP
    v_forecast := public._forecast_for_action(r.tenant_id, r.action_type);
    UPDATE decision_queue
       SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('forecast', v_forecast)
     WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Patch convert_insights_to_decisions to attach forecast on creation.
-- We wrap it as a post-trigger: instead of editing the big function,
-- add an AFTER INSERT trigger on decision_queue.
CREATE OR REPLACE FUNCTION public._tg_attach_forecast_on_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_forecast jsonb;
BEGIN
  IF NEW.payload IS NULL OR (NEW.payload->'forecast') IS NULL THEN
    v_forecast := public._forecast_for_action(NEW.tenant_id, NEW.action_type);
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('forecast', v_forecast);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_forecast_on_decision ON public.decision_queue;
CREATE TRIGGER trg_attach_forecast_on_decision
BEFORE INSERT ON public.decision_queue
FOR EACH ROW
EXECUTE FUNCTION public._tg_attach_forecast_on_decision();

-- Run backfill once
SELECT public.backfill_decision_forecasts();

GRANT EXECUTE ON FUNCTION public._forecast_for_action(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_decision_forecasts() TO service_role;
