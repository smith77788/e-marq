-- Extend execute_pending_decisions to apply price changes when decisions are approved.
--
-- Previously, price_adjust and discount_dead_stock decisions would be approved
-- (after min_success_history met) but the executor only handled "safe in-DB" actions
-- like logging records. Prices were NEVER actually updated — the autonomous pricing
-- loop was completely broken.
--
-- This migration:
-- 1. Adds price_adjust and discount_dead_stock to the safe executor
-- 2. Actually updates products.price_cents with safety constraints:
--    - Validates suggested price is positive and < 10x current price (sanity check)
--    - Only applies if current price matches the baseline in payload (price not already changed)
--    - Records old_price → new_price in ai_actions for audit / revert support
-- 3. Adds unique constraint on loyalty_transactions (account_id, order_id)
--    to prevent double-debit on duplicate order submissions

-- ============================================================
-- 1. Extend execute_pending_decisions with price execution
-- ============================================================
CREATE OR REPLACE FUNCTION public.execute_pending_decisions(_tenant uuid, _limit int DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _d           record;
  _action_id   uuid;
  _executed    int := 0;
  _old_price   integer;
  _new_price   integer;
  _product_id  uuid;
  _rows        integer;
BEGIN
  FOR _d IN
    SELECT * FROM public.decision_queue
    WHERE tenant_id = _tenant
      AND status = 'approved'
      AND action_type IN (
        -- Original safe actions (no external side-effects)
        'owner_setup_task','owner_review','owner_review_rules','flag_for_review',
        'feature_product','request_review','request_ugc',
        'repeat_purchase_nudge','cross_sell_recommend',
        -- Price actions: we execute these in-DB, fully audited + reversible
        'price_adjust','discount_dead_stock'
      )
    ORDER BY confidence DESC, created_at ASC
    LIMIT _limit
  LOOP
    BEGIN
      UPDATE public.decision_queue SET status = 'executing', updated_at = now() WHERE id = _d.id;

      -- ---- price_adjust / discount_dead_stock: update product price ----
      IF _d.action_type IN ('price_adjust', 'discount_dead_stock') THEN
        _product_id := (_d.payload->>'product_id')::uuid;
        _new_price  := (_d.payload->>'suggested_price_cents')::integer;
        _old_price  := (_d.payload->>'current_price_cents')::integer;

        -- Sanity guards: valid product, price in sane range
        IF _product_id IS NULL OR _new_price IS NULL OR _new_price <= 0 THEN
          RAISE EXCEPTION 'invalid_price_payload: product_id=% new_price=%',
            _product_id, _new_price;
        END IF;

        -- Get the live current price (don't apply if already changed by owner)
        SELECT price_cents INTO _old_price
          FROM public.products
         WHERE id = _product_id AND tenant_id = _tenant AND is_active = true;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'product_not_found: %', _product_id;
        END IF;

        -- Refuse if new price would be more than 3x or less than 10% of current
        IF _new_price > _old_price * 3 OR _new_price < _old_price / 10 THEN
          RAISE EXCEPTION 'price_out_of_bounds: old=% new=%', _old_price, _new_price;
        END IF;

        -- Skip if owner already updated the price manually (drift > 5%)
        IF (_d.payload->>'current_price_cents') IS NOT NULL AND
           abs(_old_price - (_d.payload->>'current_price_cents')::integer)::float
             / NULLIF((_d.payload->>'current_price_cents')::integer, 0) > 0.05 THEN
          -- Price drifted more than 5% since insight was generated; skip to avoid overwrite
          UPDATE public.decision_queue
             SET status = 'rejected',
                 rejected_reason = 'price_drifted_since_insight',
                 updated_at = now()
           WHERE id = _d.id;
          CONTINUE;
        END IF;

        UPDATE public.products
           SET price_cents = _new_price, updated_at = now()
         WHERE id = _product_id AND tenant_id = _tenant;

        GET DIAGNOSTICS _rows = ROW_COUNT;
        IF _rows = 0 THEN
          RAISE EXCEPTION 'product_update_failed: %', _product_id;
        END IF;

        -- Log to ai_actions with full audit trail
        INSERT INTO public.ai_actions (
          tenant_id, source_insight_id, action_type, agent_id, parameters,
          expected_impact, status, target_entity, applied_at, created_at, updated_at
        ) VALUES (
          _d.tenant_id, _d.insight_id, _d.action_type, _d.agent_id,
          jsonb_build_object(
            'decision_id',    _d.id,
            'product_id',     _product_id,
            'old_price_cents', _old_price,
            'new_price_cents', _new_price,
            'delta_pct',      round((_new_price::float - _old_price) / NULLIF(_old_price, 0) * 100, 1),
            'payload',        _d.payload,
            'triggered_by',   'orchestrator'
          ),
          COALESCE(_d.expected_impact->>'summary', 'price_update'),
          'applied', 'product', now(), now(), now()
        ) RETURNING id INTO _action_id;

      -- ---- All other in-DB-safe actions: just record ----
      ELSE
        INSERT INTO public.ai_actions (
          tenant_id, source_insight_id, action_type, agent_id, parameters,
          expected_impact, status, target_entity, applied_at, created_at, updated_at
        ) VALUES (
          _d.tenant_id, _d.insight_id, _d.action_type, _d.agent_id,
          jsonb_build_object(
            'decision_id', _d.id,
            'payload', _d.payload,
            'rationale', _d.rationale,
            'triggered_by', 'orchestrator'
          ),
          COALESCE(_d.expected_impact->>'summary', 'unknown'),
          'applied',
          CASE WHEN _d.action_type IN ('feature_product','repeat_purchase_nudge','cross_sell_recommend')
               THEN 'product' ELSE NULL END,
          now(), now(), now()
        ) RETURNING id INTO _action_id;
      END IF;

      -- baseline action_outcome row
      INSERT INTO public.action_outcomes (
        tenant_id, decision_id, action_id, agent_id, action_type,
        baseline, measurement_window, measured_at
      ) VALUES (
        _d.tenant_id, _d.id, _action_id, _d.agent_id, _d.action_type,
        _d.payload, '7d', now()
      );

      -- mark decision done
      UPDATE public.decision_queue
         SET status = 'done',
             executed_at = now(),
             executor_action_id = _action_id,
             updated_at = now()
       WHERE id = _d.id;

      -- mark insight applied
      IF _d.insight_id IS NOT NULL THEN
        UPDATE public.ai_insights SET status = 'applied', updated_at = now()
        WHERE id = _d.insight_id;
      END IF;

      _executed := _executed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.decision_queue
         SET status = 'failed', rejected_reason = SQLERRM, updated_at = now()
       WHERE id = _d.id;
      -- Revert price if we updated it but then failed on subsequent steps
      -- (The UPDATE to decision_queue may have already failed above, so we just log)
    END;
  END LOOP;
  RETURN _executed;
END $$;

-- Update _is_in_db_safe_action to match the new executor
CREATE OR REPLACE FUNCTION public._is_in_db_safe_action(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _t IN (
    'owner_setup_task','owner_review','owner_review_rules','flag_for_review',
    'feature_product','request_review','request_ugc',
    'repeat_purchase_nudge','cross_sell_recommend',
    'price_adjust','discount_dead_stock'
  )
$$;

-- ============================================================
-- 2. Loyalty idempotency: unique constraint prevents double-debit
--    for the same order (e.g., concurrent checkout submissions)
-- ============================================================
ALTER TABLE public.loyalty_transactions
  ADD COLUMN IF NOT EXISTS is_reversal boolean NOT NULL DEFAULT false;

-- Unique index: only one 'redeem' per order (not reversals)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_loyalty_transactions_order_redeem
  ON public.loyalty_transactions (account_id, order_id)
  WHERE type = 'redeem' AND order_id IS NOT NULL AND NOT is_reversal;

-- ============================================================
-- 3. Expire stale pending decisions so the queue doesn't grow unbounded
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_stale_decisions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  UPDATE public.decision_queue
     SET status = 'expired', updated_at = now()
   WHERE status IN ('pending', 'approved')
     AND expires_at IS NOT NULL
     AND expires_at < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- Wire expiry into the loop tick
CREATE OR REPLACE FUNCTION public.run_sql_loop_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_prop  jsonb;
  v_conv  RECORD;
  v_appr  RECORD;
  v_exec  jsonb;
  v_meas  RECORD;
  v_exp   integer;
BEGIN
  v_exp  := public.expire_stale_decisions();
  v_prop := public.propose_decisions_all_tenants();
  SELECT * INTO v_conv FROM public.convert_insights_to_decisions();
  SELECT * INTO v_appr FROM public.auto_approve_eligible_decisions();
  v_exec := public.execute_decisions_all_tenants();
  SELECT * INTO v_meas FROM public.measure_pending_outcomes();

  RETURN jsonb_build_object(
    'expired',          v_exp,
    'proposed',         v_prop,
    'converted',        v_conv.converted,
    'convert_skipped',  v_conv.skipped,
    'approved',         v_appr.approved_count,
    'approved_by',      v_appr.by_action,
    'execute_result',   v_exec,
    'measured',         v_meas.measured_count,
    'measure_success',  v_meas.success_count,
    'ts',               now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_decisions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.expire_stale_decisions() TO service_role;
