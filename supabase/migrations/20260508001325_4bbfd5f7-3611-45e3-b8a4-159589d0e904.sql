CREATE OR REPLACE FUNCTION public.set_tenant_integration_active(
  _tenant_id uuid,
  _provider text,
  _is_active boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  clean_provider text := lower(btrim(coalesce(_provider, '')));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF clean_provider = '' THEN RAISE EXCEPTION 'invalid_provider'; END IF;

  UPDATE public.tenant_integrations
  SET is_active = coalesce(_is_active, true), updated_at = now()
  WHERE tenant_id = _tenant_id AND provider = clean_provider;

  IF NOT FOUND THEN RAISE EXCEPTION 'integration_not_found'; END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_tenant_integration(
  _tenant_id uuid,
  _provider text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  clean_provider text := lower(btrim(coalesce(_provider, '')));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF clean_provider = '' THEN RAISE EXCEPTION 'invalid_provider'; END IF;

  DELETE FROM public.tenant_integrations
  WHERE tenant_id = _tenant_id AND provider = clean_provider;

  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_tenant_integration_active(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_tenant_integration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tenant_integration_active(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_tenant_integration(uuid, text) TO authenticated;