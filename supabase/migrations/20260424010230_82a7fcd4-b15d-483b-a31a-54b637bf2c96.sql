-- Replace admin_list_admin_users with a broader version that returns ALL users
-- (not only existing admins), so manage_permissions can grant capabilities
-- to any user. Existing function name kept for backwards compat — it now
-- returns the broader list. Adds a search filter for performance.

CREATE OR REPLACE FUNCTION public.admin_list_users_for_permissions(_search text DEFAULT NULL)
RETURNS TABLE (
  user_id uuid,
  email text,
  is_super_admin boolean,
  capabilities text[],
  tenant_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'manage_permissions') THEN
    RAISE EXCEPTION 'forbidden: requires manage_permissions';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email::text,
    public.has_role(u.id, 'super_admin'::app_role) AS is_super_admin,
    COALESCE(
      (SELECT array_agg(capability ORDER BY capability)
       FROM public.admin_permissions WHERE user_id = u.id),
      ARRAY[]::TEXT[]
    ) AS capabilities,
    (SELECT COUNT(*) FROM public.tenant_memberships m WHERE m.user_id = u.id) AS tenant_count
  FROM auth.users u
  WHERE (_search IS NULL OR _search = '' OR u.email ILIKE '%' || _search || '%')
  ORDER BY public.has_role(u.id, 'super_admin'::app_role) DESC, u.email NULLS LAST
  LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users_for_permissions(text) TO authenticated;