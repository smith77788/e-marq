
CREATE OR REPLACE FUNCTION public._is_in_db_safe_action(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT _t IN (
    'owner_setup_task','owner_review','owner_review_rules','flag_for_review',
    'feature_product','request_review','request_ugc',
    'repeat_purchase_nudge','cross_sell_recommend',
    'winback_outreach','discount_dead_stock','price_adjust'
  )
$$;

SELECT public.execute_decisions_all_tenants();
