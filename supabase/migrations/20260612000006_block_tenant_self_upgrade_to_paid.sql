-- ============================================================================
-- Stop the revenue leak: tenant admins self-activating PAID plans for free
-- ============================================================================
-- owner_change_plan lets is_tenant_admin OR is_super_admin set any active+public
-- plan and immediately grants its benefits (AI credits, agent access, higher
-- limits) — with NO charge. A tenant owner can self-upgrade to Starter/Growth/
-- Scale and pay nothing.
--
-- Full subscription billing (charges, invoices, gateway) is a larger build
-- (tracked in ROADMAP). The minimal safe guard now: a tenant admin may only
-- move to a FREE plan (price_cents_monthly = 0); moving to a paid plan requires
-- super_admin (manual/comped upgrades) until real billing exists. Downgrades to
-- free still work. Only caller is OwnerPlanSwitcher (manual click), so no
-- automatic flow breaks.
-- ============================================================================

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

  -- Paid plans require super_admin until subscription billing exists.
  IF _new_plan.price_cents_monthly > 0 AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'paid_plan_requires_payment' USING ERRCODE = '42501';
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
