-- Admin tools for managing user profiles, balances and plans across tenants.

-- 1) List tenants owned by or shared with a target user, with plan + balance summary.
CREATE OR REPLACE FUNCTION public.admin_list_user_tenants(_target_user_id uuid)
RETURNS TABLE(
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  tenant_status text,
  role text,
  plan_key text,
  plan_name text,
  subscription_status text,
  ai_credits_balance integer,
  money_balance_cents integer,
  current_period_end timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    t.slug,
    t.status::text,
    coalesce(m.role, CASE WHEN t.owner_user_id = _target_user_id THEN 'owner' ELSE NULL END),
    coalesce(p.key, 'free'),
    coalesce(p.name, 'Free'),
    coalesce(s.status, 'no_plan'),
    coalesce(b.ai_credits_balance, 0),
    coalesce(b.money_balance_cents, 0),
    s.current_period_end
  FROM public.tenants t
  LEFT JOIN public.tenant_memberships m
    ON m.tenant_id = t.id AND m.user_id = _target_user_id
  LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
  LEFT JOIN public.plans p ON p.id = s.plan_id
  LEFT JOIN public.tenant_balances b ON b.tenant_id = t.id
  WHERE t.owner_user_id = _target_user_id
     OR m.user_id = _target_user_id
  ORDER BY t.created_at DESC;
END;
$$;

-- 2) Adjust AI credits balance (positive=top-up, negative=deduct). Logs to balance_ledger.
CREATE OR REPLACE FUNCTION public.admin_adjust_ai_credits(
  _tenant_id uuid,
  _delta integer,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_balance integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _delta IS NULL OR _delta = 0 THEN
    RAISE EXCEPTION 'delta must be non-zero';
  END IF;
  IF abs(_delta) > 1000000 THEN
    RAISE EXCEPTION 'delta out of range';
  END IF;

  INSERT INTO public.tenant_balances (tenant_id) VALUES (_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_balances
     SET ai_credits_balance = GREATEST(0, ai_credits_balance + _delta),
         last_grant_at = CASE WHEN _delta > 0 THEN now() ELSE last_grant_at END,
         updated_at = now()
   WHERE tenant_id = _tenant_id
   RETURNING ai_credits_balance INTO _new_balance;

  INSERT INTO public.balance_ledger
    (tenant_id, kind, direction, amount, balance_after, reason, reference_kind, actor_user_id)
  VALUES
    (_tenant_id, 'ai_credits',
     CASE WHEN _delta > 0 THEN 'credit' ELSE 'debit' END,
     abs(_delta), _new_balance,
     coalesce(_reason, 'Admin manual adjustment'),
     'admin_adjust', auth.uid());

  RETURN _new_balance;
END;
$$;

-- 3) Adjust money balance in cents.
CREATE OR REPLACE FUNCTION public.admin_adjust_money_balance(
  _tenant_id uuid,
  _delta_cents integer,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_balance integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _delta_cents IS NULL OR _delta_cents = 0 THEN
    RAISE EXCEPTION 'delta must be non-zero';
  END IF;
  IF abs(_delta_cents) > 1000000000 THEN
    RAISE EXCEPTION 'delta out of range';
  END IF;

  INSERT INTO public.tenant_balances (tenant_id) VALUES (_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_balances
     SET money_balance_cents = GREATEST(0, money_balance_cents + _delta_cents),
         updated_at = now()
   WHERE tenant_id = _tenant_id
   RETURNING money_balance_cents INTO _new_balance;

  INSERT INTO public.balance_ledger
    (tenant_id, kind, direction, amount, balance_after, reason, reference_kind, actor_user_id)
  VALUES
    (_tenant_id, 'money',
     CASE WHEN _delta_cents > 0 THEN 'credit' ELSE 'debit' END,
     abs(_delta_cents), _new_balance,
     coalesce(_reason, 'Admin manual money adjustment'),
     'admin_adjust', auth.uid());

  RETURN _new_balance;
END;
$$;
