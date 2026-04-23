-- Verification metadata columns
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- create_my_tenant: pending for non-admins, active for super-admins
CREATE OR REPLACE FUNCTION public.create_my_tenant(_name text, _slug text)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  uid uuid := auth.uid();
  clean_slug text;
  new_row public.tenants;
  is_admin boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF _name IS NULL OR length(btrim(_name)) < 2 THEN
    RAISE EXCEPTION 'name_too_short';
  END IF;

  clean_slug := lower(regexp_replace(coalesce(_slug, ''), '[^a-z0-9-]', '', 'g'));
  IF length(clean_slug) < 2 THEN
    RAISE EXCEPTION 'slug_too_short';
  END IF;

  SELECT public.has_role(uid, 'super_admin'::app_role) INTO is_admin;

  INSERT INTO public.tenants (name, slug, owner_user_id, status, verification_requested_at, verified_at, verified_by)
  VALUES (
    btrim(_name),
    clean_slug,
    uid,
    CASE WHEN is_admin THEN 'active'::tenant_status ELSE 'pending'::tenant_status END,
    CASE WHEN is_admin THEN NULL ELSE now() END,
    CASE WHEN is_admin THEN now() ELSE NULL END,
    CASE WHEN is_admin THEN uid ELSE NULL END
  )
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$function$;

-- Allow tenant SELECT for the owner_user_id even before they become a member
DROP POLICY IF EXISTS tenants_select_member_or_super ON public.tenants;
CREATE POLICY tenants_select_member_or_super ON public.tenants
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.is_tenant_member(id)
    OR owner_user_id = auth.uid()
  );

-- admin_verify_tenant: approve a pending brand
CREATE OR REPLACE FUNCTION public.admin_verify_tenant(_tenant_id uuid)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.tenants;
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'change_status') THEN
    RAISE EXCEPTION 'forbidden: requires change_status';
  END IF;
  UPDATE public.tenants
     SET status = 'active'::tenant_status,
         verified_at = now(),
         verified_by = auth.uid(),
         rejection_reason = NULL,
         updated_at = now()
   WHERE id = _tenant_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- admin_reject_tenant: reject with a reason
CREATE OR REPLACE FUNCTION public.admin_reject_tenant(_tenant_id uuid, _reason text)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.tenants;
BEGIN
  IF NOT public.admin_has_capability(auth.uid(), 'change_status') THEN
    RAISE EXCEPTION 'forbidden: requires change_status';
  END IF;
  UPDATE public.tenants
     SET status = 'suspended'::tenant_status,
         rejection_reason = coalesce(nullif(btrim(_reason), ''), 'Відхилено супер-адміном'),
         updated_at = now()
   WHERE id = _tenant_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- admin_list_pending_tenants: list of brands awaiting verification
CREATE OR REPLACE FUNCTION public.admin_list_pending_tenants()
RETURNS TABLE(
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  owner_user_id uuid,
  owner_email text,
  verification_requested_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.name,
    t.slug,
    t.owner_user_id,
    u.email::text,
    t.verification_requested_at,
    t.created_at
  FROM public.tenants t
  LEFT JOIN auth.users u ON u.id = t.owner_user_id
  WHERE t.status = 'pending'::tenant_status
    AND public.admin_has_capability(auth.uid(), 'read_tenants')
  ORDER BY coalesce(t.verification_requested_at, t.created_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_verify_tenant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_tenant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_tenants() TO authenticated;