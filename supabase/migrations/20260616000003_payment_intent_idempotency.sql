-- ============================================================
-- Payment intent idempotency
-- Replace create_payment_intent with an idempotent version:
-- if a 'pending' intent for the same order+provider already exists
-- and was created within 30 minutes, return the existing id + url
-- instead of creating a new one (and a new gateway charge).
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_payment_intent(
  _order_id    UUID,
  _provider    TEXT,
  _amount_cents INTEGER,
  _redirect_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      public.orders;
  v_intent_id  UUID;
  v_redirect   TEXT;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status = 'paid' THEN RAISE EXCEPTION 'already_paid'; END IF;

  -- Idempotency: reuse a recent pending intent (< 30 min old)
  SELECT id, redirect_url
  INTO v_intent_id, v_redirect
  FROM public.payment_intents
  WHERE order_id = _order_id
    AND provider  = _provider
    AND status    = 'pending'
    AND created_at >= now() - INTERVAL '30 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_intent_id IS NOT NULL THEN
    -- Return cached intent; caller can reuse redirect_url
    RETURN jsonb_build_object(
      'intent_id',    v_intent_id,
      'redirect_url', v_redirect,
      'cached',       true
    );
  END IF;

  -- No usable recent intent → create a new one
  INSERT INTO public.payment_intents (
    tenant_id, order_id, provider, amount_cents, currency, status, redirect_url
  ) VALUES (
    v_order.tenant_id, _order_id, _provider, _amount_cents, v_order.currency, 'pending', _redirect_url
  ) RETURNING id INTO v_intent_id;

  RETURN jsonb_build_object(
    'intent_id',    v_intent_id,
    'redirect_url', NULL,
    'cached',       false
  );
END;
$$;

-- Revoke public/anon access (service-role only, same as before)
REVOKE ALL ON FUNCTION public.create_payment_intent(uuid, text, integer, text) FROM public, anon, authenticated;
