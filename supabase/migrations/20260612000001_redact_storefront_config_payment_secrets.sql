-- ============================================================================
-- SECURITY FIX: get_storefront_config leaked merchant payment secrets to anon
-- ============================================================================
-- Before this migration get_storefront_config (SECURITY DEFINER, GRANTed to
-- anon) returned the ENTIRE tenant_configs.features.payments object. That
-- object stores private gateway credentials:
--   liqpay_private_key, liqpay_public_key,
--   wayforpay_secret_key, wayforpay_merchant_account, wayforpay_merchant_domain,
--   monobank_token
-- Any anonymous visitor could call
--   supabase.rpc('get_storefront_config', { _slug: '<any-active-store>' })
-- and read them. A leaked LiqPay private key lets an attacker forge a valid
-- payment callback signature and mark orders paid without paying.
--
-- The storefront only needs the PUBLIC payment surface: which methods are
-- enabled, the manual-payment instructions/contact, and the currency. We now
-- whitelist exactly those eight fields; secrets never leave the server.
--
-- NOTE: keys saved before this migration may already have been exposed —
-- merchants should rotate their gateway credentials.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_storefront_config(_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _cfg public.tenant_configs;
  _features jsonb;
  _payments jsonb;
  _safe_payments jsonb;
BEGIN
  SELECT id INTO _tenant_id
  FROM public.tenants
  WHERE slug = _slug AND status = 'active'
  LIMIT 1;
  IF _tenant_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _cfg FROM public.tenant_configs WHERE tenant_id = _tenant_id;
  _features := COALESCE(_cfg.features, '{}'::jsonb);
  _payments := COALESCE(_features -> 'payments', '{}'::jsonb);

  -- Whitelist ONLY non-secret, storefront-facing payment fields.
  -- Secrets (liqpay_private_key, liqpay_public_key, wayforpay_secret_key,
  -- wayforpay_merchant_account, wayforpay_merchant_domain, monobank_token)
  -- are intentionally excluded and must stay server-only.
  _safe_payments := jsonb_strip_nulls(jsonb_build_object(
    'manual_enabled',      _payments -> 'manual_enabled',
    'stripe_enabled',      _payments -> 'stripe_enabled',
    'liqpay_enabled',      _payments -> 'liqpay_enabled',
    'wayforpay_enabled',   _payments -> 'wayforpay_enabled',
    'monobank_enabled',    _payments -> 'monobank_enabled',
    'manual_instructions', _payments -> 'manual_instructions',
    'manual_contact',      _payments -> 'manual_contact',
    'currency',            _payments -> 'currency'
  ));

  RETURN jsonb_build_object(
    'tenant_id', _tenant_id,
    'brand_name', COALESCE(_cfg.brand_name, ''),
    'ui', COALESCE(_cfg.ui, '{}'::jsonb),
    'seo', COALESCE(_cfg.seo, '{}'::jsonb),
    'features', jsonb_build_object('payments', _safe_payments)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_storefront_config(text) TO anon, authenticated;
