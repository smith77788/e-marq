-- ============================================================================
-- Subscription billing: payment intents for plan upgrades
-- ============================================================================
-- Adds subscription_payments table to track recurring/one-time payments for
-- plan upgrades. Links to tenant_subscriptions and orders tables.
-- ============================================================================

-- Subscription payment status enum
DO $$ BEGIN
  CREATE TYPE public.subscription_payment_status AS ENUM (
    'pending', 'processing', 'completed', 'failed', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Subscription payments table
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.tenant_subscriptions(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'UAH',
  status public.subscription_payment_status NOT NULL DEFAULT 'pending',
  provider text, -- liqpay | wayforpay | monobank
  provider_order_id text, -- external payment system order ID
  provider_transaction_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- Tenants can read their own subscription payments
CREATE POLICY "tenant_read_subscription_payments"
  ON public.subscription_payments
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

-- Super admins can do everything
CREATE POLICY "super_admin_all_subscription_payments"
  ON public.subscription_payments
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Service role can insert/update (for callbacks)
CREATE POLICY "service_role_manage_subscription_payments"
  ON public.subscription_payments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscription_payments_tenant ON public.subscription_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_status ON public.subscription_payments(status);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_provider_order ON public.subscription_payments(provider_order_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_subscription_payment_updated()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_subscription_payment_updated ON public.subscription_payments;
CREATE TRIGGER on_subscription_payment_updated
  BEFORE UPDATE ON public.subscription_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_subscription_payment_updated();

-- ============================================================================
-- RPC: Create subscription payment intent
-- ============================================================================
-- Creates a pending payment record and returns payment details for gateway redirect.
-- Called by OwnerPlanSwitcher when upgrading to a paid plan.

CREATE OR REPLACE FUNCTION public.create_subscription_payment(
  _tenant_id uuid,
  _plan_key text,
  _provider text DEFAULT 'liqpay'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan public.plans;
  _sub public.tenant_subscriptions;
  _payment_id uuid;
  _provider_order_id text;
BEGIN
  -- Auth check
  IF NOT (public.is_tenant_admin(_tenant_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Find plan
  SELECT * INTO _plan
  FROM public.plans
  WHERE key = _plan_key AND is_active = true AND (is_public = true OR public.is_super_admin());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found: %', _plan_key;
  END IF;

  -- Must be a paid plan
  IF _plan.price_cents_monthly <= 0 THEN
    RAISE EXCEPTION 'Cannot create payment for free plan';
  END IF;

  -- Get or create subscription
  SELECT * INTO _sub FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;
  IF _sub.id IS NULL THEN
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status)
    VALUES (_tenant_id, _plan.id, 'trial')
    RETURNING * INTO _sub;
  END IF;

  -- Generate provider order ID: sub_{tenant_id_short}_{timestamp}
  _provider_order_id := 'sub_' || left(replace(_tenant_id::text, '-', ''), 8) || '_' || extract(epoch from now())::bigint;

  -- Create payment record
  INSERT INTO public.subscription_payments (tenant_id, subscription_id, plan_id, amount_cents, currency, provider, provider_order_id, status)
  VALUES (_tenant_id, _sub.id, _plan.id, _plan.price_cents_monthly, COALESCE(_plan.currency, 'UAH'), _provider, _provider_order_id, 'pending')
  RETURNING id INTO _payment_id;

  -- Return payment details
  RETURN jsonb_build_object(
    'payment_id', _payment_id,
    'provider_order_id', _provider_order_id,
    'amount_cents', _plan.price_cents_monthly,
    'currency', COALESCE(_plan.currency, 'UAH'),
    'plan_name', _plan.name,
    'plan_key', _plan.key
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_subscription_payment(uuid, text, text) TO authenticated;

-- ============================================================================
-- RPC: Complete subscription payment (called by payment callbacks)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_subscription_payment(
  _provider_order_id text,
  _provider text,
  _provider_transaction_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payment public.subscription_payments;
BEGIN
  -- Find the payment
  SELECT * INTO _payment
  FROM public.subscription_payments
  WHERE provider_order_id = _provider_order_id AND provider = _provider AND status = 'pending';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Update payment status
  UPDATE public.subscription_payments
  SET status = 'completed',
      provider_transaction_id = _provider_transaction_id,
      updated_at = now()
  WHERE id = _payment.id;

  -- Activate subscription
  UPDATE public.tenant_subscriptions
  SET plan_id = _payment.plan_id,
      status = 'active',
      current_period_start = now(),
      current_period_end = now() + interval '30 days',
      updated_at = now()
  WHERE id = _payment.subscription_id;

  -- Log plan change
  INSERT INTO public.plan_change_log (tenant_id, from_plan_id, to_plan_id, actor_user_id, reason)
  SELECT _payment.tenant_id, ts.plan_id, _payment.plan_id, NULL, 'Subscription payment completed'
  FROM public.tenant_subscriptions ts
  WHERE ts.id = _payment.subscription_id;

  -- Grant AI credits for the new plan
  PERFORM public.add_balance(
    _payment.tenant_id,
    'ai_credits',
    (SELECT max_ai_credits_monthly_grant FROM public.plans WHERE id = _payment.plan_id),
    'Subscription payment credits',
    'payment_grant'
  );

  RETURN true;
END;
$$;
