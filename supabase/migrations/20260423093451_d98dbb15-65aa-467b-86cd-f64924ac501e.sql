-- 1. Capabilities catalog
CREATE TABLE IF NOT EXISTS public.admin_capabilities (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO public.admin_capabilities (key, label, description, sort_order) VALUES
  ('read_tenants',       'Перегляд брендів',       'Бачити список усіх брендів і їх статистику', 10),
  ('manage_users',       'Керування користувачами','Редагувати баланси, AI-кредити, склад команди', 20),
  ('change_plans',       'Зміна тарифів',          'Перемикати тарифні плани брендів', 30),
  ('change_status',      'Зміна статусу',          'Призупиняти/відновлювати/вимикати бренди', 40),
  ('manage_permissions', 'Керування правами',      'Видавати та відкликати права іншим адмінам', 50)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.admin_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone authed reads capabilities" ON public.admin_capabilities;
CREATE POLICY "anyone authed reads capabilities"
  ON public.admin_capabilities FOR SELECT TO authenticated USING (true);

-- 2. Per-user permissions
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  capability TEXT NOT NULL REFERENCES public.admin_capabilities(key) ON DELETE CASCADE,
  granted_by UUID,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, capability)
);
CREATE INDEX IF NOT EXISTS idx_admin_permissions_user ON public.admin_permissions(user_id);
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

-- 3. Capability check
CREATE OR REPLACE FUNCTION public.admin_has_capability(_user_id UUID, _capability TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.admin_permissions
      WHERE user_id = _user_id AND capability = _capability
    )
$$;

DROP POLICY IF EXISTS "see own permissions" ON public.admin_permissions;
CREATE POLICY "see own permissions"
  ON public.admin_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.admin_has_capability(auth.uid(), 'manage_permissions'));

DROP POLICY IF EXISTS "managers insert permissions" ON public.admin_permissions;
CREATE POLICY "managers insert permissions"
  ON public.admin_permissions FOR INSERT TO authenticated
  WITH CHECK (public.admin_has_capability(auth.uid(), 'manage_permissions'));

DROP POLICY IF EXISTS "managers delete permissions" ON public.admin_permissions;
CREATE POLICY "managers delete permissions"
  ON public.admin_permissions FOR DELETE TO authenticated
  USING (public.admin_has_capability(auth.uid(), 'manage_permissions'));

-- 4. Grant / revoke RPCs
CREATE OR REPLACE FUNCTION public.admin_grant_capability(_target_user UUID, _capability TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'manage_permissions') THEN
    RAISE EXCEPTION 'forbidden: requires manage_permissions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_capabilities WHERE key = _capability) THEN
    RAISE EXCEPTION 'unknown capability: %', _capability;
  END IF;
  INSERT INTO public.admin_permissions (user_id, capability, granted_by)
  VALUES (_target_user, _capability, auth.uid())
  ON CONFLICT (user_id, capability) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_capability(_target_user UUID, _capability TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'manage_permissions') THEN
    RAISE EXCEPTION 'forbidden: requires manage_permissions';
  END IF;
  DELETE FROM public.admin_permissions
  WHERE user_id = _target_user AND capability = _capability;
END; $$;

-- 5. List admin users with their capability matrix
CREATE OR REPLACE FUNCTION public.admin_list_admin_users()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  is_super_admin BOOLEAN,
  capabilities TEXT[]
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'manage_permissions') THEN
    RAISE EXCEPTION 'forbidden: requires manage_permissions';
  END IF;

  RETURN QUERY
  WITH admins AS (
    SELECT ur.user_id FROM public.user_roles ur
    WHERE ur.role IN ('super_admin'::app_role, 'admin'::app_role)
    UNION
    SELECT ap.user_id FROM public.admin_permissions ap
  )
  SELECT
    a.user_id,
    u.email::text,
    public.has_role(a.user_id, 'super_admin'::app_role),
    COALESCE(
      (SELECT array_agg(capability ORDER BY capability)
       FROM public.admin_permissions WHERE user_id = a.user_id),
      ARRAY[]::TEXT[]
    )
  FROM admins a
  LEFT JOIN auth.users u ON u.id = a.user_id
  ORDER BY 3 DESC, 2;
END; $$;

-- 6. Wrapper functions that enforce capabilities and call existing implementations.
-- We keep original RPC return types intact, but add capability gates by replacing
-- the body. Easiest route: add prerequisite SECURITY DEFINER guard via wrapper.
-- We modify the existing functions in-place but preserve return type.

CREATE OR REPLACE FUNCTION public.change_tenant_plan(
  _tenant_id UUID, _plan_key TEXT, _reason TEXT DEFAULT NULL
) RETURNS public.tenant_subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plan_id UUID;
  v_row public.tenant_subscriptions;
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'change_plans') THEN
    RAISE EXCEPTION 'forbidden: requires change_plans';
  END IF;

  SELECT id INTO v_plan_id FROM public.plans WHERE key = _plan_key AND is_active = true;
  IF v_plan_id IS NULL THEN RAISE EXCEPTION 'plan % not found', _plan_key; END IF;

  UPDATE public.tenant_subscriptions
     SET plan_id = v_plan_id, updated_at = now()
   WHERE tenant_id = _tenant_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status)
    VALUES (_tenant_id, v_plan_id, 'active') RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_status(
  _tenant_id UUID, _status TEXT
) RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.tenants;
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'change_status') THEN
    RAISE EXCEPTION 'forbidden: requires change_status';
  END IF;
  IF _status NOT IN ('active','suspended','inactive') THEN
    RAISE EXCEPTION 'invalid status: %', _status;
  END IF;
  UPDATE public.tenants SET status = _status, updated_at = now()
   WHERE id = _tenant_id RETURNING * INTO v_row;
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_adjust_ai_credits(
  _tenant_id UUID, _delta INTEGER, _reason TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_new INTEGER;
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'manage_users') THEN
    RAISE EXCEPTION 'forbidden: requires manage_users';
  END IF;
  UPDATE public.tenant_subscriptions
     SET ai_credits_balance = GREATEST(0, COALESCE(ai_credits_balance,0) + _delta),
         updated_at = now()
   WHERE tenant_id = _tenant_id
   RETURNING ai_credits_balance INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'no subscription for %', _tenant_id; END IF;

  INSERT INTO public.balance_ledger
    (tenant_id, kind, direction, amount, balance_after, reason, actor_user_id)
  VALUES
    (_tenant_id, 'ai_credit',
     CASE WHEN _delta >= 0 THEN 'credit' ELSE 'debit' END,
     ABS(_delta), v_new, COALESCE(_reason,'Admin adjust'), auth.uid());
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_adjust_money_balance(
  _tenant_id UUID, _delta_cents INTEGER, _reason TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_new INTEGER;
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'manage_users') THEN
    RAISE EXCEPTION 'forbidden: requires manage_users';
  END IF;
  UPDATE public.tenant_subscriptions
     SET money_balance_cents = GREATEST(0, COALESCE(money_balance_cents,0) + _delta_cents),
         updated_at = now()
   WHERE tenant_id = _tenant_id
   RETURNING money_balance_cents INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'no subscription for %', _tenant_id; END IF;

  INSERT INTO public.balance_ledger
    (tenant_id, kind, direction, amount, balance_after, reason, actor_user_id)
  VALUES
    (_tenant_id, 'money',
     CASE WHEN _delta_cents >= 0 THEN 'credit' ELSE 'debit' END,
     ABS(_delta_cents), v_new, COALESCE(_reason,'Admin adjust'), auth.uid());
  RETURN v_new;
END; $$;