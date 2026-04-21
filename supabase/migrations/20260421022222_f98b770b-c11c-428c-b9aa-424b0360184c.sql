
-- Tenant invitations
CREATE TABLE public.tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'admin',
  invited_by uuid,
  token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  status text NOT NULL DEFAULT 'pending', -- pending, accepted, cancelled, expired
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email, status) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX ti_email ON public.tenant_invitations(lower(email)) WHERE status = 'pending';
CREATE INDEX ti_token ON public.tenant_invitations(token);

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ti_select ON public.tenant_invitations
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_tenant_admin(tenant_id)
    OR lower(email) = lower(coalesce(auth.email(), ''))
  );

CREATE POLICY ti_insert ON public.tenant_invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY ti_update ON public.tenant_invitations
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_tenant_admin(tenant_id)
    OR lower(email) = lower(coalesce(auth.email(), ''))
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_tenant_admin(tenant_id)
    OR lower(email) = lower(coalesce(auth.email(), ''))
  );

CREATE POLICY ti_delete ON public.tenant_invitations
  FOR DELETE TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- Accept invitation: creates membership, marks invite accepted
CREATE OR REPLACE FUNCTION public.accept_tenant_invitation(_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _inv public.tenant_invitations;
  _email text;
BEGIN
  _email := coalesce(auth.email(), '');
  IF _email = '' THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO _inv FROM public.tenant_invitations WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF _inv.status <> 'pending' THEN RAISE EXCEPTION 'Invitation is %', _inv.status; END IF;
  IF _inv.expires_at < now() THEN
    UPDATE public.tenant_invitations SET status = 'expired' WHERE id = _inv.id;
    RAISE EXCEPTION 'Invitation expired';
  END IF;
  IF lower(_inv.email) <> lower(_email) THEN
    RAISE EXCEPTION 'Invitation email mismatch';
  END IF;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
  VALUES (_inv.tenant_id, auth.uid(), _inv.role)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = _inv.role;

  UPDATE public.tenant_invitations
  SET status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  WHERE id = _inv.id;

  RETURN jsonb_build_object('tenant_id', _inv.tenant_id, 'role', _inv.role);
END;
$$;

-- List my tenants with plan info (for switcher)
CREATE OR REPLACE FUNCTION public.get_my_tenants()
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  membership_role text,
  plan_key text,
  plan_name text,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    t.id,
    t.name,
    t.slug,
    m.role::text,
    coalesce(p.key, 'free'),
    coalesce(p.name, 'Free'),
    coalesce(s.status, 'active')
  FROM public.tenants t
  JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.user_id = auth.uid()
  LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
  LEFT JOIN public.plans p ON p.id = s.plan_id
  ORDER BY t.created_at DESC;
$$;

-- Cross-tenant overview for super-admin (includes usage/balances)
CREATE OR REPLACE FUNCTION public.get_all_tenants_overview()
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  status text,
  plan_key text,
  plan_name text,
  subscription_status text,
  ai_credits_balance integer,
  money_balance_cents integer,
  ai_runs_this_period bigint,
  orders_this_period bigint,
  products_count bigint,
  customers_count bigint,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    t.id, t.name, t.slug, t.status::text,
    coalesce(p.key, 'free'),
    coalesce(p.name, 'Free'),
    coalesce(s.status, 'no_plan'),
    coalesce(b.ai_credits_balance, 0),
    coalesce(b.money_balance_cents, 0),
    public.get_current_usage(t.id, 'ai_runs_count'),
    public.get_current_usage(t.id, 'orders_count'),
    public.get_current_usage(t.id, 'products_count'),
    public.get_current_usage(t.id, 'customers_count'),
    t.created_at
  FROM public.tenants t
  LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
  LEFT JOIN public.plans p ON p.id = s.plan_id
  LEFT JOIN public.tenant_balances b ON b.tenant_id = t.id
  ORDER BY t.created_at DESC;
END;
$$;
