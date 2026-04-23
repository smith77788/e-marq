-- 1. List tenant members with email
CREATE OR REPLACE FUNCTION public.admin_list_tenant_members(_tenant_id uuid)
RETURNS TABLE(
  user_id uuid,
  email text,
  role text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  is_owner boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;

  SELECT owner_user_id INTO _owner FROM public.tenants WHERE id = _tenant_id;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    COALESCE(m.role, CASE WHEN u.id = _owner THEN 'owner' ELSE NULL END) AS role,
    COALESCE(m.created_at, (SELECT created_at FROM public.tenants WHERE id = _tenant_id)),
    u.last_sign_in_at,
    (u.id = _owner) AS is_owner
  FROM auth.users u
  LEFT JOIN public.tenant_memberships m
    ON m.user_id = u.id AND m.tenant_id = _tenant_id
  WHERE m.user_id IS NOT NULL OR u.id = _owner
  ORDER BY (u.id = _owner) DESC, COALESCE(m.created_at, u.created_at);
END;
$$;

-- 2. List pending invitations with inviter email
CREATE OR REPLACE FUNCTION public.admin_list_tenant_invites(_tenant_id uuid)
RETURNS TABLE(
  id uuid,
  email text,
  role text,
  status text,
  token text,
  expires_at timestamptz,
  created_at timestamptz,
  invited_by_email text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.role,
    i.status,
    i.token,
    i.expires_at,
    i.created_at,
    u.email::text AS invited_by_email
  FROM public.tenant_invitations i
  LEFT JOIN auth.users u ON u.id = i.invited_by
  WHERE i.tenant_id = _tenant_id
    AND i.status = 'pending'
  ORDER BY i.created_at DESC;
END;
$$;

-- 3. Set tenant status (active / suspended / inactive)
CREATE OR REPLACE FUNCTION public.admin_set_tenant_status(_tenant_id uuid, _status text)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.tenants;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;
  IF _status NOT IN ('active','suspended','inactive') THEN
    RAISE EXCEPTION 'invalid status: %', _status;
  END IF;

  UPDATE public.tenants
  SET status = _status::public.tenant_status,
      updated_at = now()
  WHERE id = _tenant_id
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

-- 4. Get owner email + member count for tenants overview
CREATE OR REPLACE FUNCTION public.admin_get_tenant_owner(_tenant_id uuid)
RETURNS TABLE(owner_id uuid, owner_email text, member_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    t.owner_user_id,
    u.email::text,
    (SELECT count(*) FROM public.tenant_memberships m WHERE m.tenant_id = _tenant_id) AS member_count
  FROM public.tenants t
  LEFT JOIN auth.users u ON u.id = t.owner_user_id
  WHERE t.id = _tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_tenant_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_tenant_invites(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_tenant_owner(uuid) TO authenticated;