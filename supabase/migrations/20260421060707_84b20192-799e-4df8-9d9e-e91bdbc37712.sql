-- Allow tenant owners/admins to self-change their plan and top up balances.
-- These are SECURITY DEFINER RPCs that bypass the strict super_admin gates,
-- but enforce that the caller is owner/admin of the tenant via is_tenant_admin().

-- 1) Owner-side plan change. Mirrors change_tenant_plan but allows tenant admins.
CREATE OR REPLACE FUNCTION public.owner_change_plan(_tenant_id uuid, _plan_key text, _reason text DEFAULT NULL)
RETURNS public.tenant_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_plan public.plans;
  _old_sub public.tenant_subscriptions;
  _new_sub public.tenant_subscriptions;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _new_plan
  FROM public.plans
  WHERE key = _plan_key AND is_active = true AND (is_public = true OR public.is_super_admin());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or not available: %', _plan_key;
  END IF;

  SELECT * INTO _old_sub FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;

  IF _old_sub.id IS NULL THEN
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id)
    VALUES (_tenant_id, _new_plan.id)
    RETURNING * INTO _new_sub;
  ELSE
    UPDATE public.tenant_subscriptions
    SET plan_id = _new_plan.id, status = 'active', updated_at = now()
    WHERE tenant_id = _tenant_id
    RETURNING * INTO _new_sub;
  END IF;

  INSERT INTO public.plan_change_log (tenant_id, from_plan_id, to_plan_id, actor_user_id, reason)
  VALUES (_tenant_id, _old_sub.plan_id, _new_plan.id, auth.uid(), COALESCE(_reason, 'Self-service plan change'));

  -- grant monthly AI credits for the new plan
  IF _new_plan.max_ai_credits_monthly_grant > 0 THEN
    PERFORM public.add_balance(_tenant_id, 'ai_credits', _new_plan.max_ai_credits_monthly_grant,
                               'Plan grant: ' || _new_plan.name, 'plan_grant');
  END IF;

  RETURN _new_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_change_plan(uuid, text, text) TO authenticated;

-- 2) Owner-side balance top-up. Allows tenant admins to add AI credits
-- (capped per call to prevent abuse). Money balance remains super_admin only.
CREATE OR REPLACE FUNCTION public.owner_topup_ai_credits(_tenant_id uuid, _amount integer, _reason text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_balance integer;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000 THEN
    RAISE EXCEPTION 'Amount must be between 1 and 100000';
  END IF;

  INSERT INTO public.tenant_balances (tenant_id) VALUES (_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_balances
  SET ai_credits_balance = ai_credits_balance + _amount,
      last_grant_at = now(),
      updated_at = now()
  WHERE tenant_id = _tenant_id
  RETURNING ai_credits_balance INTO _new_balance;

  INSERT INTO public.balance_ledger (tenant_id, kind, direction, amount, balance_after, reason, reference_kind, actor_user_id)
  VALUES (_tenant_id, 'ai_credits', 'credit', _amount, _new_balance,
          COALESCE(_reason, 'Self-service top-up'), 'owner_topup', auth.uid());

  RETURN _new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_topup_ai_credits(uuid, integer, text) TO authenticated;