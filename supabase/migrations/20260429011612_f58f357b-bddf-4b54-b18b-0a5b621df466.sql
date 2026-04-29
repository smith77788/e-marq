
CREATE OR REPLACE FUNCTION public.measure_decision_outcomes(_tenant uuid, _limit int DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _ao record;
  _measured int := 0;
  _success boolean;
  _actual jsonb;
  _attr bigint;
  _notes text;
  _product_id uuid;
  _baseline_revenue bigint;
  _current_revenue bigint;
  _insight_id uuid;
  _insight_type text;
  _insight_recurred boolean;
  _follow_up_count int;
BEGIN
  FOR _ao IN
    SELECT ao.*, d.executed_at, d.insight_id AS dq_insight_id
    FROM public.action_outcomes ao
    JOIN public.decision_queue d ON d.id = ao.decision_id
    WHERE ao.tenant_id = _tenant
      AND ao.success IS NULL
      AND d.executed_at IS NOT NULL
      AND d.executed_at <= now() - interval '7 days'
    ORDER BY ao.measured_at ASC
    LIMIT _limit
  LOOP
    _success := NULL; _actual := '{}'::jsonb; _attr := 0; _notes := NULL;

    BEGIN
      IF _ao.action_type IN ('feature_product','cross_sell_recommend','repeat_purchase_nudge') THEN
        _product_id := NULLIF(_ao.baseline->>'product_id','')::uuid;
        IF _product_id IS NOT NULL THEN
          -- baseline 7d before executed_at
          SELECT COALESCE(SUM(oi.quantity * oi.unit_price_cents),0)::bigint
            INTO _baseline_revenue
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
           WHERE oi.tenant_id = _tenant
             AND oi.product_id = _product_id
             AND o.created_at >= _ao.executed_at - interval '7 days'
             AND o.created_at <  _ao.executed_at
             AND o.status::text IN ('paid','fulfilled','shipped','delivered','completed');

          SELECT COALESCE(SUM(oi.quantity * oi.unit_price_cents),0)::bigint
            INTO _current_revenue
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
           WHERE oi.tenant_id = _tenant
             AND oi.product_id = _product_id
             AND o.created_at >= _ao.executed_at
             AND o.created_at <  _ao.executed_at + interval '7 days'
             AND o.status::text IN ('paid','fulfilled','shipped','delivered','completed');

          _attr := GREATEST(_current_revenue - _baseline_revenue, 0);
          _success := _current_revenue > _baseline_revenue;
          _actual := jsonb_build_object(
            'product_id', _product_id,
            'revenue_7d_before_cents', _baseline_revenue,
            'revenue_7d_after_cents', _current_revenue
          );
          _notes := 'product revenue compared 7d window';
        ELSE
          _success := false;
          _notes := 'no product_id in baseline';
        END IF;

      ELSIF _ao.action_type IN ('request_review','request_ugc') THEN
        SELECT COUNT(*)::int INTO _follow_up_count
          FROM public.events
         WHERE tenant_id = _tenant
           AND created_at >= _ao.executed_at
           AND created_at <  _ao.executed_at + interval '7 days'
           AND type::text IN ('review_submitted','ugc_submitted','review_received');
        _success := _follow_up_count > 0;
        _actual := jsonb_build_object('follow_up_events', _follow_up_count);
        _notes := 'counted follow-up events 7d after execution';

      ELSIF _ao.action_type IN ('flag_for_review','owner_setup_task','owner_review','owner_review_rules') THEN
        -- meta task: success = the same insight type for the same tenant did NOT recur in 7d
        _insight_id := _ao.dq_insight_id;
        _insight_type := NULL;
        IF _insight_id IS NOT NULL THEN
          SELECT insight_type INTO _insight_type FROM public.ai_insights WHERE id = _insight_id;
        END IF;
        IF _insight_type IS NULL THEN
          _success := true;
          _notes := 'meta task — no original insight to track';
        ELSE
          SELECT EXISTS (
            SELECT 1 FROM public.ai_insights
             WHERE tenant_id = _tenant
               AND insight_type = _insight_type
               AND created_at > _ao.executed_at
               AND created_at <= _ao.executed_at + interval '7 days'
               AND id <> _insight_id
          ) INTO _insight_recurred;
          _success := NOT _insight_recurred;
          _actual := jsonb_build_object('insight_type', _insight_type, 'recurred_within_7d', _insight_recurred);
          _notes := 'meta task — checked insight recurrence';
        END IF;

      ELSE
        _success := NULL;
        _notes := 'no measurement strategy for action_type=' || _ao.action_type;
      END IF;

      -- write back via the existing rpc
      PERFORM public.mark_decision_outcome(
        _ao.decision_id, COALESCE(_success, false), _actual, _attr, _notes
      );

      _measured := _measured + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.action_outcomes
         SET notes = 'measurement_error: ' || SQLERRM, measured_at = now()
       WHERE id = _ao.id;
    END;
  END LOOP;

  RETURN _measured;
END $$;

CREATE OR REPLACE FUNCTION public.measure_outcomes_all_tenants()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _result jsonb := '[]'::jsonb; _n int;
BEGIN
  FOR _t IN SELECT id FROM public.tenants WHERE status IN ('active','pending') LOOP
    BEGIN
      _n := public.measure_decision_outcomes(_t.id);
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'measured', _n);
    EXCEPTION WHEN OTHERS THEN
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN _result;
END $$;

REVOKE EXECUTE ON FUNCTION public.measure_decision_outcomes(uuid, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.measure_outcomes_all_tenants() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.measure_decision_outcomes(uuid, int) TO service_role, authenticated;
GRANT  EXECUTE ON FUNCTION public.measure_outcomes_all_tenants() TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('measure-outcomes-every-hour'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'measure-outcomes-every-hour',
  '17 * * * *',
  $cmd$ SELECT public.measure_outcomes_all_tenants(); $cmd$
);
