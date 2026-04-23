-- Atomic helper: any logged-in user can create a tenant they own.
-- Bypasses RLS noise (auth.uid() vs user_id mismatches across triggers)
-- by setting owner_user_id = auth.uid() in a SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.create_my_tenant(_name text, _slug text)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  clean_slug text;
  new_row public.tenants;
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

  INSERT INTO public.tenants (name, slug, owner_user_id, status)
  VALUES (btrim(_name), clean_slug, uid, 'active')
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_tenant(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_my_tenant(text, text) TO authenticated;