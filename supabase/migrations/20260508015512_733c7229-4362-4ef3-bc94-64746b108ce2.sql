CREATE OR REPLACE FUNCTION public.create_my_tenant(_name text, _slug text)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  clean_slug := regexp_replace(clean_slug, '-+', '-', 'g');
  clean_slug := trim(both '-' from clean_slug);
  IF length(clean_slug) < 2 THEN
    RAISE EXCEPTION 'slug_too_short';
  END IF;

  INSERT INTO public.tenants (name, slug, owner_user_id, status)
  VALUES (btrim(_name), clean_slug, uid, 'active'::public.tenant_status)
  RETURNING * INTO new_row;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
  VALUES (new_row.id, uid, 'owner'::public.tenant_role)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner'::public.tenant_role;

  INSERT INTO public.tenant_configs (tenant_id, brand_name)
  VALUES (new_row.id, new_row.name)
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN new_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_onboarding_product(
  _tenant_id uuid,
  _name text,
  _price_cents integer,
  _stock integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) < 1 THEN RAISE EXCEPTION 'product_name_required'; END IF;
  IF coalesce(_price_cents, 0) <= 0 THEN RAISE EXCEPTION 'product_price_required'; END IF;

  INSERT INTO public.products (tenant_id, name, price_cents, stock, is_active, metadata)
  VALUES (_tenant_id, btrim(_name), _price_cents, greatest(coalesce(_stock, 0), 0), true, jsonb_build_object('source', 'onboarding'))
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_onboarding_customers(_tenant_id uuid, _customers jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  imported_count integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF jsonb_typeof(_customers) <> 'array' THEN RAISE EXCEPTION 'customers_array_required'; END IF;
  IF jsonb_array_length(_customers) = 0 THEN RAISE EXCEPTION 'customers_empty'; END IF;
  IF jsonb_array_length(_customers) > 500 THEN RAISE EXCEPTION 'customers_limit_500'; END IF;

  WITH rows AS (
    SELECT
      lower(nullif(btrim(value->>'email'), '')) AS email,
      nullif(btrim(value->>'name'), '') AS name
    FROM jsonb_array_elements(_customers)
  ), clean AS (
    SELECT DISTINCT ON (email) email, name
    FROM rows
    WHERE email IS NOT NULL AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    ORDER BY email, name NULLS LAST
  ), upserted AS (
    INSERT INTO public.customers (tenant_id, email, name, metadata)
    SELECT _tenant_id, email, name, jsonb_build_object('source', 'onboarding') FROM clean
    ON CONFLICT (tenant_id, lower(email)) WHERE email IS NOT NULL DO UPDATE
      SET name = coalesce(excluded.name, public.customers.name),
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO imported_count FROM upserted;

  IF imported_count = 0 THEN RAISE EXCEPTION 'no_valid_customers'; END IF;
  RETURN imported_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_payment_method(_tenant_id uuid, _method text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _method NOT IN ('manual', 'stripe') THEN RAISE EXCEPTION 'invalid_payment_method'; END IF;

  INSERT INTO public.tenant_configs (tenant_id, brand_name, features)
  SELECT t.id, t.name, jsonb_build_object('payment_method', _method)
  FROM public.tenants t
  WHERE t.id = _tenant_id
  ON CONFLICT (tenant_id) DO UPDATE
    SET features = coalesce(public.tenant_configs.features, '{}'::jsonb) || jsonb_build_object('payment_method', _method),
        updated_at = now();

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_telegram_owner_pairing(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  code text;
  exp timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT p.pairing_code, p.expires_at INTO code, exp
  FROM public.telegram_owner_pairings p
  WHERE p.tenant_id = _tenant_id
    AND p.consumed_at IS NULL
    AND p.expires_at > now()
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF code IS NULL THEN
    LOOP
      code := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=', 'XYZ'), 1, 8));
      exp := now() + interval '30 minutes';
      BEGIN
        INSERT INTO public.telegram_owner_pairings (tenant_id, pairing_code, created_by, expires_at)
        VALUES (_tenant_id, code, uid, exp);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        code := NULL;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('pairing_code', code, 'expires_at', exp);
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_tenant_integration(
  _tenant_id uuid,
  _provider text,
  _credentials text DEFAULT NULL,
  _config jsonb DEFAULT '{}'::jsonb,
  _last_sync_status text DEFAULT 'saved_unverified',
  _last_sync_error text DEFAULT NULL,
  _webhook_secret text DEFAULT NULL
)
RETURNS public.tenant_integrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  row public.tenant_integrations;
  clean_provider text := lower(btrim(coalesce(_provider, '')));
  safe_status text := coalesce(nullif(btrim(_last_sync_status), ''), 'saved_unverified');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF clean_provider = '' OR clean_provider !~ '^[a-z0-9_-]+$' THEN
    RAISE EXCEPTION 'invalid_provider';
  END IF;

  INSERT INTO public.tenant_integrations (
    tenant_id, provider, is_active, credentials_encrypted, config,
    last_sync_status, last_sync_error, webhook_secret
  )
  VALUES (
    _tenant_id,
    clean_provider,
    true,
    nullif(_credentials, ''),
    coalesce(_config, '{}'::jsonb),
    safe_status,
    nullif(_last_sync_error, ''),
    nullif(_webhook_secret, '')
  )
  ON CONFLICT (tenant_id, provider) DO UPDATE SET
    is_active = true,
    credentials_encrypted = coalesce(nullif(excluded.credentials_encrypted, ''), public.tenant_integrations.credentials_encrypted),
    config = coalesce(public.tenant_integrations.config, '{}'::jsonb) || coalesce(excluded.config, '{}'::jsonb),
    last_sync_status = excluded.last_sync_status,
    last_sync_error = excluded.last_sync_error,
    webhook_secret = coalesce(excluded.webhook_secret, public.tenant_integrations.webhook_secret),
    updated_at = now()
  RETURNING * INTO row;

  RETURN row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_my_tenant(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_onboarding_product(uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.import_onboarding_customers(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_tenant_payment_method(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_telegram_owner_pairing(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_tenant_integration(uuid, text, text, jsonb, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_my_tenant(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_onboarding_product(uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_onboarding_customers(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_payment_method(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_telegram_owner_pairing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_tenant_integration(uuid, text, text, jsonb, text, text, text) TO authenticated;

INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
SELECT t.id, t.owner_user_id, 'owner'::public.tenant_role
FROM public.tenants t
WHERE t.owner_user_id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner'::public.tenant_role;

INSERT INTO public.tenant_configs (tenant_id, brand_name)
SELECT t.id, t.name
FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;