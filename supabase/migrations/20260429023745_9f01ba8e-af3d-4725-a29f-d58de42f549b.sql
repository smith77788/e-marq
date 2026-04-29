CREATE OR REPLACE FUNCTION public._map_insight_to_action(_insight_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _insight_type
    WHEN 'churn_risk'              THEN 'winback_outreach'
    WHEN 'vip_silent'              THEN 'winback_outreach'
    WHEN 'dead_stock'              THEN 'discount_dead_stock'
    WHEN 'dead_stock_signal'       THEN 'discount_dead_stock'
    WHEN 'price_optimization'      THEN 'price_adjust'
    WHEN 'stockout_critical'       THEN 'owner_setup_task'
    WHEN 'low_stock'               THEN 'owner_setup_task'
    WHEN 'low_stock_warning'       THEN 'owner_setup_task'
    WHEN 'hot_seller_restock'      THEN 'owner_setup_task'
    WHEN 'conversion_drop'         THEN 'flag_for_review'
    WHEN 'refund_risk_high'        THEN 'flag_for_review'
    WHEN 'cross_sell_opportunity'  THEN 'cross_sell_recommend'
    WHEN 'next_best_product'       THEN 'cross_sell_recommend'
    WHEN 'review_opportunity'      THEN 'request_review'
    WHEN 'csat_request'            THEN 'request_review'
    WHEN 'social_proof_hidden_gem' THEN 'request_review'
    WHEN 'ugc_opportunity'         THEN 'request_ugc'
    WHEN 'ugc_harvest_opportunity' THEN 'request_ugc'
    WHEN 'ugc_low_volume'          THEN 'request_ugc'
    WHEN 'feature_product_opp'     THEN 'feature_product'
    WHEN 'repeat_purchase_opp'     THEN 'repeat_purchase_nudge'
    WHEN 'second_order_gap'        THEN 'repeat_purchase_nudge'
    WHEN 'broadcast_suggestion'    THEN 'request_review'
    WHEN 'loyalty_tier_proposal'   THEN 'owner_review'
    WHEN 'owner_playbook'          THEN 'owner_setup_task'
    WHEN 'learning_loop_negative_rules' THEN 'owner_review'
    WHEN 'learning_loop_silent_agents'  THEN 'owner_review'
    ELSE
      CASE
        WHEN _insight_type LIKE 'bootstrap\_%' ESCAPE '\' THEN 'owner_setup_task'
        WHEN _insight_type LIKE 'setup\_%'     ESCAPE '\' THEN 'owner_setup_task'
        ELSE NULL
      END
  END;
$function$;

-- Resurrect insights that were marked 'applied' without producing a decision
-- (status='applied' AND no decision_queue row referencing them)
UPDATE public.ai_insights ai
   SET status = 'new', updated_at = now()
 WHERE ai.status = 'applied'
   AND ai.created_at > now() - interval '30 days'
   AND public._map_insight_to_action(ai.insight_type) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.decision_queue dq
      WHERE dq.insight_id = ai.id
   );

-- Run loop tick to process the resurrected insights
SELECT public.run_sql_loop_tick();