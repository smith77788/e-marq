-- ========== Sprint 7: UA Payment Gateways ==========

-- 1. Розширюємо дозволені payment_method
CREATE OR REPLACE FUNCTION public.validate_order_payment_method()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_method NOT IN ('stripe_card', 'manual', 'liqpay', 'wayforpay', 'monobank') THEN
    RAISE EXCEPTION 'Invalid payment_method: %', NEW.payment_method;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. payment_intents — журнал спроб оплати
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('liqpay', 'wayforpay', 'monobank', 'stripe', 'manual')),
  external_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UAH',
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending', 'success', 'failed', 'cancelled', 'refunded', 'expired')),
  redirect_url TEXT,
  callback_payload JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_order ON public.payment_intents(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant ON public.payment_intents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_external ON public.payment_intents(provider, external_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON public.payment_intents(tenant_id, status);

DROP TRIGGER IF EXISTS update_payment_intents_updated_at ON public.payment_intents;
CREATE TRIGGER update_payment_intents_updated_at
BEFORE UPDATE ON public.payment_intents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_intents_member_read" ON public.payment_intents
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- write — тільки service role (webhooks)
CREATE POLICY "payment_intents_admin_update" ON public.payment_intents
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 3. payment_callbacks_log — append-only audit
CREATE TABLE IF NOT EXISTS public.payment_callbacks_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  external_id TEXT,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  raw_body TEXT,
  parsed_payload JSONB NOT NULL DEFAULT '{}',
  http_status INTEGER NOT NULL DEFAULT 200,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_callbacks_provider ON public.payment_callbacks_log(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_callbacks_order ON public.payment_callbacks_log(order_id);

ALTER TABLE public.payment_callbacks_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_callbacks_log_super_read" ON public.payment_callbacks_log
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- 4. RPC: mark_order_paid_by_gateway — викликається з webhook
-- Idempotent: повторні виклики при status=paid повертають існуючий order без змін.
CREATE OR REPLACE FUNCTION public.mark_order_paid_by_gateway(
  _order_id UUID,
  _provider TEXT,
  _external_id TEXT,
  _amount_cents INTEGER,
  _payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_intent_id UUID;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;

  -- Idempotency: if already paid, no-op
  IF v_order.status = 'paid' THEN
    -- Still update intent if exists & not yet success
    UPDATE public.payment_intents
    SET status = 'success',
        external_id = COALESCE(_external_id, external_id),
        callback_payload = _payload,
        completed_at = COALESCE(completed_at, now())
    WHERE order_id = _order_id AND provider = _provider AND status <> 'success';
    RETURN _order_id;
  END IF;

  -- Sanity check: amount matches (allow ±1 cent rounding)
  IF abs(v_order.total_cents - _amount_cents) > 1 THEN
    RAISE EXCEPTION 'amount_mismatch: order=%, callback=%', v_order.total_cents, _amount_cents;
  END IF;

  UPDATE public.orders
  SET status = 'paid',
      payment_ref = COALESCE(_external_id, payment_ref),
      payment_method = COALESCE(_provider, payment_method),
      paid_at = now()
  WHERE id = _order_id;

  -- Upsert intent
  SELECT id INTO v_intent_id FROM public.payment_intents
  WHERE order_id = _order_id AND provider = _provider
  ORDER BY created_at DESC LIMIT 1;

  IF v_intent_id IS NOT NULL THEN
    UPDATE public.payment_intents
    SET status = 'success',
        external_id = COALESCE(_external_id, external_id),
        callback_payload = _payload,
        completed_at = now()
    WHERE id = v_intent_id;
  ELSE
    INSERT INTO public.payment_intents (
      tenant_id, order_id, provider, external_id, amount_cents,
      currency, status, callback_payload, completed_at
    ) VALUES (
      v_order.tenant_id, _order_id, _provider, _external_id, _amount_cents,
      v_order.currency, 'success', _payload, now()
    );
  END IF;

  RETURN _order_id;
END;
$$;

-- service role only
REVOKE ALL ON FUNCTION public.mark_order_paid_by_gateway(uuid, text, text, integer, jsonb) FROM public, anon, authenticated;

-- 5. RPC: create_payment_intent — викликається з server function (service role)
CREATE OR REPLACE FUNCTION public.create_payment_intent(
  _order_id UUID,
  _provider TEXT,
  _amount_cents INTEGER,
  _redirect_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_intent_id UUID;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status = 'paid' THEN RAISE EXCEPTION 'already_paid'; END IF;

  INSERT INTO public.payment_intents (
    tenant_id, order_id, provider, amount_cents, currency, status, redirect_url
  ) VALUES (
    v_order.tenant_id, _order_id, _provider, _amount_cents, v_order.currency, 'pending', _redirect_url
  ) RETURNING id INTO v_intent_id;

  RETURN v_intent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payment_intent(uuid, text, integer, text) FROM public, anon, authenticated;

-- 6. RPC: mark_payment_failed — для webhook'ів які повідомляють про failure
CREATE OR REPLACE FUNCTION public.mark_payment_failed(
  _order_id UUID,
  _provider TEXT,
  _external_id TEXT,
  _error TEXT,
  _payload JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent_id UUID;
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.orders WHERE id = _order_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  SELECT id INTO v_intent_id FROM public.payment_intents
  WHERE order_id = _order_id AND provider = _provider
  ORDER BY created_at DESC LIMIT 1;

  IF v_intent_id IS NOT NULL THEN
    UPDATE public.payment_intents
    SET status = 'failed', external_id = COALESCE(_external_id, external_id),
        error_message = _error, callback_payload = _payload, completed_at = now()
    WHERE id = v_intent_id;
  ELSE
    INSERT INTO public.payment_intents (
      tenant_id, order_id, provider, external_id, amount_cents, status,
      error_message, callback_payload, completed_at
    )
    SELECT tenant_id, _order_id, _provider, _external_id, total_cents, 'failed', _error, _payload, now()
    FROM public.orders WHERE id = _order_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_payment_failed(uuid, text, text, text, jsonb) FROM public, anon, authenticated;