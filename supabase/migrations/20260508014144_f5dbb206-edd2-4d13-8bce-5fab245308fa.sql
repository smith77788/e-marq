CREATE OR REPLACE FUNCTION public.get_my_tenants()
RETURNS TABLE(
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  membership_role text,
  plan_key text,
  plan_name text,
  status text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
  SELECT t.id, uid, 'owner'
  FROM public.tenants t
  WHERE t.owner_user_id = uid
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role = CASE
      WHEN public.tenant_memberships.role IN ('owner', 'admin') THEN public.tenant_memberships.role
      ELSE 'owner'
    END;

  RETURN QUERY
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    t.slug AS tenant_slug,
    CASE
      WHEN t.owner_user_id = uid THEN 'owner'
      ELSE m.role::text
    END AS membership_role,
    coalesce(p.key, 'free') AS plan_key,
    coalesce(p.name, 'Free') AS plan_name,
    coalesce(t.status::text, coalesce(s.status, 'active')) AS status
  FROM public.tenants t
  LEFT JOIN public.tenant_memberships m
    ON m.tenant_id = t.id
   AND m.user_id = uid
  LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
  LEFT JOIN public.plans p ON p.id = s.plan_id
  WHERE t.owner_user_id = uid OR m.user_id = uid
  ORDER BY t.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_tenants() TO authenticated;