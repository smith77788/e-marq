-- Адмін-функції для керування ролями та переліком користувачів

-- Список усіх користувачів з ролями (тільки super_admin)
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_super_admin boolean,
  tenant_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'super_admin') AS is_super_admin,
    (SELECT count(*) FROM public.tenant_memberships m WHERE m.user_id = u.id) AS tenant_count
  FROM auth.users u
  ORDER BY u.created_at DESC
  LIMIT 500;
END;
$$;

-- Призначити super_admin (тільки наявний super_admin)
CREATE OR REPLACE FUNCTION public.admin_grant_super_admin(_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, 'super_admin')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

-- Зняти super_admin (не можна зняти останнього)
CREATE OR REPLACE FUNCTION public.admin_revoke_super_admin(_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count int;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;

  SELECT count(*) INTO _count FROM public.user_roles WHERE role = 'super_admin';
  IF _count <= 1 THEN
    RAISE EXCEPTION 'Cannot revoke the last super_admin';
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id AND role = 'super_admin';
END;
$$;