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
  IF length(clean_slug) < 2 THEN
    RAISE EXCEPTION 'slug_too_short';
  END IF;

  INSERT INTO public.tenants (
    name, slug, owner_user_id, status,
    verification_requested_at, verified_at, verified_by
  )
  VALUES (
    btrim(_name),
    clean_slug,
    uid,
    'active'::tenant_status,
    now(),
    NULL,
    NULL
  )
  RETURNING * INTO new_row;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
  VALUES (new_row.id, uid, 'owner')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';

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

  INSERT INTO public.products (tenant_id, name, price_cents, stock, is_active)
  VALUES (_tenant_id, btrim(_name), _price_cents, greatest(coalesce(_stock, 0), 0), true)
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
  inserted_count integer := 0;
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
  ), ins AS (
    INSERT INTO public.customers (tenant_id, email, name)
    SELECT _tenant_id, email, name FROM clean
    ON CONFLICT (tenant_id, lower(email)) WHERE email IS NOT NULL DO UPDATE
      SET name = coalesce(excluded.name, public.customers.name),
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO inserted_count FROM ins;

  IF inserted_count = 0 THEN RAISE EXCEPTION 'no_valid_customers'; END IF;
  RETURN inserted_count;
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
    code := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=', 'XYZ'), 1, 8));
    exp := now() + interval '30 minutes';
    INSERT INTO public.telegram_owner_pairings (tenant_id, pairing_code, created_by, expires_at)
    VALUES (_tenant_id, code, uid, exp);
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
  IF clean_provider = '' OR clean_provider !~ '^[a-z0-9_\-]+$' THEN
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
    config = excluded.config,
    last_sync_status = excluded.last_sync_status,
    last_sync_error = excluded.last_sync_error,
    webhook_secret = coalesce(excluded.webhook_secret, public.tenant_integrations.webhook_secret),
    updated_at = now()
  RETURNING * INTO row;

  RETURN row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_integration_webhook_secret(
  _tenant_id uuid,
  _provider text,
  _webhook_secret text
)
RETURNS text
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
  IF _webhook_secret IS NULL OR length(_webhook_secret) < 16 THEN RAISE EXCEPTION 'invalid_secret'; END IF;

  UPDATE public.tenant_integrations
  SET webhook_secret = _webhook_secret, updated_at = now()
  WHERE tenant_id = _tenant_id AND provider = clean_provider;

  IF NOT FOUND THEN
    INSERT INTO public.tenant_integrations (tenant_id, provider, is_active, config, last_sync_status, webhook_secret)
    VALUES (_tenant_id, clean_provider, true, '{}'::jsonb, 'saved_unverified', _webhook_secret);
  END IF;

  RETURN _webhook_secret;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_owner_test_notification(_tenant_id uuid)
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

  INSERT INTO public.owner_notifications (
    tenant_id, kind, title, body, severity, user_id, metadata
  )
  VALUES (
    _tenant_id,
    'test_ping',
    'Тестове сповіщення з кабінету',
    'Якщо ви бачите це в Telegram із кнопками — інтеграція працює ✅',
    'high',
    uid,
    jsonb_build_object('source', 'owner_test')
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;