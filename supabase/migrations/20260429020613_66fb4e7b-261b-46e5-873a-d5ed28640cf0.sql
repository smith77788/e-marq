UPDATE public.auto_approval_policy
   SET min_success_history = 1,
       notes = 'Pricing change — 1 prior success enough; executor caps payload',
       updated_at = now()
 WHERE action_type IN ('discount_dead_stock','price_adjust');

SELECT * FROM public.auto_approve_eligible_decisions();