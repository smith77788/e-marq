-- 1) Видалити owner-manual типи з whitelist executor'а
CREATE OR REPLACE FUNCTION public._is_in_db_safe_action(_t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT _t IN (
    'feature_product','request_review','request_ugc',
    'repeat_purchase_nudge','cross_sell_recommend',
    'winback_outreach','discount_dead_stock','price_adjust'
  )
$function$;

-- 2) Виправити executor: НЕ створювати baseline action_outcome.
--    measure_pending_outcomes() сам робить запис коли настає час (executed_at + 1h).
CREATE OR REPLACE FUNCTION public.execute_pending_decisions(_tenant uuid, _limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _d record; _action_id uuid; _executed int := 0;
BEGIN
  FOR _d IN
    SELECT * FROM public.decision_queue
    WHERE tenant_id = _tenant
      AND status = 'approved'
      AND public._is_in_db_safe_action(action_type)
    ORDER BY confidence DESC, created_at ASC
    LIMIT _limit
  LOOP
    BEGIN
      UPDATE public.decision_queue SET status = 'executing', updated_at = now() WHERE id = _d.id;

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
      )
      RETURNING id INTO _action_id;

      -- НЕ створюємо baseline outcome тут! measure_pending_outcomes() зробить це коли настане час.

      UPDATE public.decision_queue
         SET status = 'done',
             executed_at = now(),
             executor_action_id = _action_id,
             updated_at = now()
       WHERE id = _d.id;

      IF _d.insight_id IS NOT NULL THEN
        UPDATE public.ai_insights SET status = 'applied', updated_at = now()
        WHERE id = _d.insight_id;
      END IF;

      _executed := _executed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.decision_queue
         SET status = 'failed', rejected_reason = SQLERRM, updated_at = now()
       WHERE id = _d.id;
    END;
  END LOOP;
  RETURN _executed;
END $function$;

-- 3) Видалити забруднені baseline-записи (без attributed_revenue, з window='7d')
DELETE FROM public.action_outcomes
 WHERE measurement_window = '7d'
   AND attributed_revenue_cents IS NULL;

-- 4) "Розмаркувати" 3 owner_setup_task що були done без owner action — повернути у pending,
--    щоб owner насправді їх побачив і міг виконати
UPDATE public.decision_queue
   SET status = 'pending',
       executed_at = NULL,
       executor_action_id = NULL,
       updated_at = now(),
       rejected_reason = 'reverted: owner_setup_task auto-marked done by removed whitelist entry'
 WHERE action_type IN ('owner_setup_task','owner_review','owner_review_rules','flag_for_review')
   AND status = 'done'
   AND approved_by_auto = false
   AND approved_at IS NULL;