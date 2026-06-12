-- ============================================================================
-- Owner-facing payment settings: read (no secrets) + write (write-only secrets)
-- ============================================================================
-- tenant_configs SELECT is admin-only, so the owner cannot read their own
-- features.payments from the client. These two SECURITY DEFINER RPCs let a
-- tenant_admin manage gateways WITHOUT the browser ever receiving the stored
-- secrets:
--   - get_tenant_payment_settings returns non-secret fields + has_*_saved flags
--   - update_tenant_payment_settings writes; secret params are NULL = keep
--     existing (so a blank field never wipes a saved key).
-- Both authorize via is_super_admin() OR is_tenant_admin(_tenant_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_payment_settings(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p jsonb;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(features -> 'payments', '{}'::jsonb) INTO _p
  FROM public.tenant_configs
  WHERE tenant_id = _tenant_id;
  _p := COALESCE(_p, '{}'::jsonb);

  RETURN jsonb_build_object(
    'currency',                   COALESCE(_p ->> 'currency', 'UAH'),
    'manual_enabled',             COALESCE((_p ->> 'manual_enabled')::boolean, true),
    'manual_instructions',        COALESCE(_p ->> 'manual_instructions', ''),
    'manual_contact',             COALESCE(_p ->> 'manual_contact', ''),
    'liqpay_enabled',             COALESCE((_p ->> 'liqpay_enabled')::boolean, false),
    'liqpay_public_key',          COALESCE(_p ->> 'liqpay_public_key', ''),
    'liqpay_secret_saved',        (COALESCE(_p ->> 'liqpay_private_key', '') <> ''),
    'wayforpay_enabled',          COALESCE((_p ->> 'wayforpay_enabled')::boolean, false),
    'wayforpay_merchant_account', COALESCE(_p ->> 'wayforpay_merchant_account', ''),
    'wayforpay_merchant_domain',  COALESCE(_p ->> 'wayforpay_merchant_domain', ''),
    'wayforpay_secret_saved',     (COALESCE(_p ->> 'wayforpay_secret_key', '') <> ''),
    'monobank_enabled',           COALESCE((_p ->> 'monobank_enabled')::boolean, false),
    'monobank_token_saved',       (COALESCE(_p ->> 'monobank_token', '') <> '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_payment_settings(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_payment_settings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_payment_settings(
  _tenant_id uuid,
  _currency text,
  _manual_enabled boolean,
  _manual_instructions text,
  _manual_contact text,
  _liqpay_enabled boolean,
  _liqpay_public_key text,
  _liqpay_private_key text,           -- NULL = keep existing
  _wayforpay_enabled boolean,
  _wayforpay_merchant_account text,
  _wayforpay_merchant_domain text,
  _wayforpay_secret_key text,         -- NULL = keep existing
  _monobank_enabled boolean,
  _monobank_token text                -- NULL = keep existing
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing jsonb;
  _new jsonb;
  _updated integer;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF char_length(COALESCE(_currency, '')) <> 3 THEN
    RAISE EXCEPTION 'invalid_currency';
  END IF;

  SELECT COALESCE(features -> 'payments', '{}'::jsonb) INTO _existing
  FROM public.tenant_configs
  WHERE tenant_id = _tenant_id;
  _existing := COALESCE(_existing, '{}'::jsonb);

  -- Non-secret fields are always overwritten.
  _new := _existing || jsonb_build_object(
    'currency',                   upper(_currency),
    'manual_enabled',             _manual_enabled,
    'manual_instructions',        COALESCE(_manual_instructions, ''),
    'manual_contact',             COALESCE(_manual_contact, ''),
    'liqpay_enabled',             _liqpay_enabled,
    'liqpay_public_key',          COALESCE(_liqpay_public_key, ''),
    'wayforpay_enabled',          _wayforpay_enabled,
    'wayforpay_merchant_account', COALESCE(_wayforpay_merchant_account, ''),
    'wayforpay_merchant_domain',  COALESCE(_wayforpay_merchant_domain, ''),
    'monobank_enabled',           _monobank_enabled
  );

  -- Secrets: overwrite ONLY when a new value is supplied (NULL = keep).
  IF _liqpay_private_key IS NOT NULL THEN
    _new := _new || jsonb_build_object('liqpay_private_key', _liqpay_private_key);
  END IF;
  IF _wayforpay_secret_key IS NOT NULL THEN
    _new := _new || jsonb_build_object('wayforpay_secret_key', _wayforpay_secret_key);
  END IF;
  IF _monobank_token IS NOT NULL THEN
    _new := _new || jsonb_build_object('monobank_token', _monobank_token);
  END IF;

  UPDATE public.tenant_configs
  SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('payments', _new),
      updated_at = now()
  WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _updated = ROW_COUNT;

  -- Config row is normally created with the tenant; insert as a safety net.
  IF _updated = 0 THEN
    INSERT INTO public.tenant_configs (tenant_id, brand_name, features)
    SELECT _tenant_id, COALESCE(t.name, 'Бренд'), jsonb_build_object('payments', _new)
    FROM public.tenants t WHERE t.id = _tenant_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_payment_settings(
  uuid, text, boolean, text, text, boolean, text, text, boolean, text, text, text, boolean, text
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_payment_settings(
  uuid, text, boolean, text, text, boolean, text, text, boolean, text, text, text, boolean, text
) TO authenticated;
