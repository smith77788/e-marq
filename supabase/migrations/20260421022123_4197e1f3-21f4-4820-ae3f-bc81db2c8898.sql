
-- =========================================================================
-- 1. PLANS CATALOG
-- =========================================================================
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_cents_monthly integer NOT NULL DEFAULT 0,
  price_cents_yearly integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  is_public boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  -- structured limits
  max_products integer,                 -- NULL = unlimited
  max_orders_per_month integer,
  max_customers integer,
  max_ai_runs_per_month integer,
  max_ai_credits_monthly_grant integer NOT NULL DEFAULT 0,
  max_outbound_messages_per_month integer,
  max_storage_mb integer,
  max_team_members integer,
  -- feature gating
  features_enabled text[] NOT NULL DEFAULT '{}',
  agents_allowed text[] NOT NULL DEFAULT '{}',  -- empty = all allowed
  -- meta
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY plans_public_read ON public.plans
  FOR SELECT TO anon, authenticated
  USING (is_active = true AND is_public = true OR public.is_super_admin());

CREATE POLICY plans_super_insert ON public.plans
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY plans_super_update ON public.plans
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY plans_super_delete ON public.plans
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE TRIGGER plans_set_updated
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 2. TENANT SUBSCRIPTIONS
-- =========================================================================
CREATE TABLE public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'active', -- trial, active, past_due, suspended, cancelled
  trial_ends_at timestamptz,
  current_period_start timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  current_period_end timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- super-admin can override individual limits
  overrides jsonb NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tsub_select ON public.tenant_subscriptions
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY tsub_super_modify_ins ON public.tenant_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY tsub_super_modify_upd ON public.tenant_subscriptions
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY tsub_super_modify_del ON public.tenant_subscriptions
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE TRIGGER tsub_set_updated
  BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 3. TENANT BALANCES
-- =========================================================================
CREATE TABLE public.tenant_balances (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  ai_credits_balance integer NOT NULL DEFAULT 0,
  ai_credits_granted_this_period integer NOT NULL DEFAULT 0,
  ai_credits_consumed_this_period integer NOT NULL DEFAULT 0,
  money_balance_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  last_grant_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY tbal_select ON public.tenant_balances
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
-- no INSERT/UPDATE/DELETE policies → only security-definer functions can write

CREATE TRIGGER tbal_set_updated
  BEFORE UPDATE ON public.tenant_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 4. USAGE COUNTERS (per-period, per-metric)
-- =========================================================================
CREATE TABLE public.tenant_usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  metric text NOT NULL,         -- orders_count, ai_runs_count, outbound_messages_count, products_count, storage_mb
  value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_start, metric)
);

CREATE INDEX tuc_tenant_metric ON public.tenant_usage_counters(tenant_id, metric, period_start DESC);

ALTER TABLE public.tenant_usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY tuc_select ON public.tenant_usage_counters
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
-- writes via security-definer triggers/functions only

-- =========================================================================
-- 5. BALANCE LEDGER (immutable audit)
-- =========================================================================
CREATE TABLE public.balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,            -- 'ai_credits' or 'money'
  direction text NOT NULL,       -- 'credit' or 'debit'
  amount integer NOT NULL,       -- positive
  balance_after integer NOT NULL,
  reason text NOT NULL,
  reference_kind text,           -- 'agent_run', 'manual_grant', 'plan_grant', 'refund', 'topup'
  reference_id uuid,
  actor_user_id uuid,            -- who triggered (NULL for system)
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bl_tenant_created ON public.balance_ledger(tenant_id, created_at DESC);

ALTER TABLE public.balance_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY bl_select ON public.balance_ledger
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
-- writes via security-definer functions only

-- =========================================================================
-- 6. PLAN CHANGE LOG
-- =========================================================================
CREATE TABLE public.plan_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_plan_id uuid REFERENCES public.plans(id),
  to_plan_id uuid NOT NULL REFERENCES public.plans(id),
  actor_user_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pcl_tenant_created ON public.plan_change_log(tenant_id, created_at DESC);

ALTER TABLE public.plan_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY pcl_select ON public.plan_change_log
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
-- writes via security-definer functions only

-- =========================================================================
-- 7. SEED DEFAULT PLANS
-- =========================================================================
INSERT INTO public.plans (
  key, name, description, price_cents_monthly, price_cents_yearly, sort_order,
  max_products, max_orders_per_month, max_customers, max_ai_runs_per_month,
  max_ai_credits_monthly_grant, max_outbound_messages_per_month, max_storage_mb, max_team_members,
  features_enabled, agents_allowed
) VALUES
  ('free', 'Free', 'Get started with the essentials', 0, 0, 1,
   25, 50, 200, 100,
   200, 100, 100, 1,
   ARRAY['bot','reorder'], ARRAY['onboarding','daily-digest','cart-recovery']),
  ('starter', 'Starter', 'For new D2C brands', 2900, 29000, 2,
   200, 500, 2000, 1000,
   2000, 1000, 1000, 3,
   ARRAY['bot','reorder','analytics','attribution'], '{}'),
  ('growth', 'Growth', 'Scale revenue with AI agents', 9900, 99000, 3,
   2000, 5000, 20000, 10000,
   20000, 10000, 5000, 10,
   ARRAY['bot','reorder','analytics','attribution','seo_autopilot','fraud_detection','segments','cohorts'], '{}'),
  ('scale', 'Scale', 'For high-volume brands', 29900, 299000, 4,
   NULL, NULL, NULL, 50000,
   100000, 50000, 50000, 25,
   ARRAY['bot','reorder','analytics','attribution','seo_autopilot','fraud_detection','segments','cohorts','priority_support','custom_agents'], '{}'),
  ('enterprise', 'Enterprise', 'Custom — talk to sales', 0, 0, 5,
   NULL, NULL, NULL, NULL,
   500000, NULL, NULL, NULL,
   ARRAY['bot','reorder','analytics','attribution','seo_autopilot','fraud_detection','segments','cohorts','priority_support','custom_agents','sla','sso'], '{}');

-- =========================================================================
-- 8. CORE FUNCTIONS
-- =========================================================================

-- Resolve effective limit (plan default OR override)
CREATE OR REPLACE FUNCTION public.get_effective_limit(_tenant_id uuid, _limit_key text)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _override jsonb;
  _override_val bigint;
  _plan_val bigint;
BEGIN
  SELECT s.overrides, p.*::jsonb
  INTO _override, _plan_val
  FROM public.tenant_subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.tenant_id = _tenant_id;

  -- check override first
  IF _override ? _limit_key THEN
    BEGIN
      _override_val := (_override ->> _limit_key)::bigint;
      RETURN _override_val;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  -- fall back to plan column
  EXECUTE format('SELECT %I FROM public.plans p JOIN public.tenant_subscriptions s ON s.plan_id = p.id WHERE s.tenant_id = $1', _limit_key)
    INTO _plan_val USING _tenant_id;

  RETURN _plan_val;
END;
$$;

-- Get current usage value for metric
CREATE OR REPLACE FUNCTION public.get_current_usage(_tenant_id uuid, _metric text)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _period_start timestamptz;
  _value bigint;
BEGIN
  SELECT current_period_start INTO _period_start
  FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;

  IF _period_start IS NULL THEN
    _period_start := date_trunc('month', now());
  END IF;

  -- "products_count" and "customers_count" are absolute, derived live
  IF _metric = 'products_count' THEN
    SELECT count(*) INTO _value FROM public.products WHERE tenant_id = _tenant_id;
    RETURN coalesce(_value, 0);
  ELSIF _metric = 'customers_count' THEN
    SELECT count(*) INTO _value FROM public.customers WHERE tenant_id = _tenant_id;
    RETURN coalesce(_value, 0);
  END IF;

  SELECT value INTO _value
  FROM public.tenant_usage_counters
  WHERE tenant_id = _tenant_id AND metric = _metric AND period_start = _period_start;

  RETURN coalesce(_value, 0);
END;
$$;

-- Increment usage counter
CREATE OR REPLACE FUNCTION public.increment_usage(_tenant_id uuid, _metric text, _delta bigint DEFAULT 1)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _period_start timestamptz;
BEGIN
  SELECT current_period_start INTO _period_start
  FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;

  IF _period_start IS NULL THEN
    _period_start := date_trunc('month', now());
  END IF;

  INSERT INTO public.tenant_usage_counters (tenant_id, period_start, metric, value)
  VALUES (_tenant_id, _period_start, _metric, _delta)
  ON CONFLICT (tenant_id, period_start, metric)
  DO UPDATE SET value = public.tenant_usage_counters.value + _delta,
                updated_at = now();
END;
$$;

-- Check plan limit (enforces cap; returns true if within limit)
CREATE OR REPLACE FUNCTION public.check_plan_limit(_tenant_id uuid, _metric text, _limit_key text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _limit bigint;
  _current bigint;
  _status text;
BEGIN
  SELECT status INTO _status FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;
  IF _status = 'suspended' OR _status = 'cancelled' THEN
    RETURN false;
  END IF;

  _limit := public.get_effective_limit(_tenant_id, _limit_key);
  IF _limit IS NULL THEN
    RETURN true; -- unlimited
  END IF;

  _current := public.get_current_usage(_tenant_id, _metric);
  RETURN _current < _limit;
END;
$$;

-- Check feature flag
CREATE OR REPLACE FUNCTION public.check_feature_enabled(_tenant_id uuid, _feature text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _features text[];
  _overrides jsonb;
  _override_features jsonb;
BEGIN
  SELECT p.features_enabled, s.overrides
  INTO _features, _overrides
  FROM public.tenant_subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.tenant_id = _tenant_id;

  -- override array can extend or replace
  IF _overrides ? 'features_enabled' THEN
    _override_features := _overrides -> 'features_enabled';
    IF jsonb_typeof(_override_features) = 'array' THEN
      RETURN _override_features ? _feature;
    END IF;
  END IF;

  RETURN _features IS NOT NULL AND _feature = ANY(_features);
END;
$$;

-- Consume AI credits atomically (returns true if consumed, false if insufficient)
CREATE OR REPLACE FUNCTION public.consume_ai_credits(
  _tenant_id uuid, _amount integer, _reason text,
  _reference_kind text DEFAULT NULL, _reference_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _new_balance integer;
BEGIN
  IF _amount <= 0 THEN RETURN true; END IF;

  -- ensure row exists
  INSERT INTO public.tenant_balances (tenant_id) VALUES (_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_balances
  SET ai_credits_balance = ai_credits_balance - _amount,
      ai_credits_consumed_this_period = ai_credits_consumed_this_period + _amount,
      updated_at = now()
  WHERE tenant_id = _tenant_id AND ai_credits_balance >= _amount
  RETURNING ai_credits_balance INTO _new_balance;

  IF _new_balance IS NULL THEN
    RETURN false; -- insufficient
  END IF;

  INSERT INTO public.balance_ledger (tenant_id, kind, direction, amount, balance_after, reason, reference_kind, reference_id)
  VALUES (_tenant_id, 'ai_credits', 'debit', _amount, _new_balance, _reason, _reference_kind, _reference_id);

  RETURN true;
END;
$$;

-- Add balance (super-admin only, or system grants)
CREATE OR REPLACE FUNCTION public.add_balance(
  _tenant_id uuid, _kind text, _amount integer, _reason text,
  _reference_kind text DEFAULT 'manual_grant'
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _new_balance integer;
  _is_system boolean;
BEGIN
  _is_system := (_reference_kind IN ('plan_grant','system_init','tenant_init'));

  IF NOT _is_system AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super-admins can add balance';
  END IF;

  IF _kind NOT IN ('ai_credits','money') THEN
    RAISE EXCEPTION 'Invalid kind: %', _kind;
  END IF;

  INSERT INTO public.tenant_balances (tenant_id) VALUES (_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  IF _kind = 'ai_credits' THEN
    UPDATE public.tenant_balances
    SET ai_credits_balance = ai_credits_balance + _amount,
        ai_credits_granted_this_period = CASE WHEN _reference_kind = 'plan_grant'
                                              THEN ai_credits_granted_this_period + _amount
                                              ELSE ai_credits_granted_this_period END,
        last_grant_at = now(),
        updated_at = now()
    WHERE tenant_id = _tenant_id
    RETURNING ai_credits_balance INTO _new_balance;
  ELSE
    UPDATE public.tenant_balances
    SET money_balance_cents = money_balance_cents + _amount,
        updated_at = now()
    WHERE tenant_id = _tenant_id
    RETURNING money_balance_cents INTO _new_balance;
  END IF;

  INSERT INTO public.balance_ledger (tenant_id, kind, direction, amount, balance_after, reason, reference_kind, actor_user_id)
  VALUES (_tenant_id, _kind,
          CASE WHEN _amount >= 0 THEN 'credit' ELSE 'debit' END,
          abs(_amount), _new_balance, _reason, _reference_kind, auth.uid());

  RETURN _new_balance;
END;
$$;

-- Change tenant plan (super-admin only)
CREATE OR REPLACE FUNCTION public.change_tenant_plan(
  _tenant_id uuid, _plan_key text, _reason text DEFAULT NULL
)
RETURNS public.tenant_subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _new_plan public.plans;
  _old_sub public.tenant_subscriptions;
  _new_sub public.tenant_subscriptions;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super-admins can change tenant plans';
  END IF;

  SELECT * INTO _new_plan FROM public.plans WHERE key = _plan_key AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found: %', _plan_key; END IF;

  SELECT * INTO _old_sub FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;

  IF _old_sub.id IS NULL THEN
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id)
    VALUES (_tenant_id, _new_plan.id)
    RETURNING * INTO _new_sub;
  ELSE
    UPDATE public.tenant_subscriptions
    SET plan_id = _new_plan.id, status = 'active', updated_at = now()
    WHERE tenant_id = _tenant_id
    RETURNING * INTO _new_sub;
  END IF;

  INSERT INTO public.plan_change_log (tenant_id, from_plan_id, to_plan_id, actor_user_id, reason)
  VALUES (_tenant_id, _old_sub.plan_id, _new_plan.id, auth.uid(), _reason);

  -- grant monthly AI credits for the new plan
  IF _new_plan.max_ai_credits_monthly_grant > 0 THEN
    PERFORM public.add_balance(_tenant_id, 'ai_credits', _new_plan.max_ai_credits_monthly_grant,
                               'Plan grant: ' || _new_plan.name, 'plan_grant');
  END IF;

  RETURN _new_sub;
END;
$$;

-- Full plan + usage snapshot for UI
CREATE OR REPLACE FUNCTION public.get_tenant_plan_summary(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _result jsonb;
  _plan public.plans;
  _sub public.tenant_subscriptions;
  _bal public.tenant_balances;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_tenant_member(_tenant_id)) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _sub FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;
  IF _sub.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _plan FROM public.plans WHERE id = _sub.plan_id;
  SELECT * INTO _bal FROM public.tenant_balances WHERE tenant_id = _tenant_id;

  _result := jsonb_build_object(
    'plan', jsonb_build_object(
      'id', _plan.id, 'key', _plan.key, 'name', _plan.name,
      'price_cents_monthly', _plan.price_cents_monthly,
      'currency', _plan.currency,
      'features_enabled', _plan.features_enabled,
      'agents_allowed', _plan.agents_allowed
    ),
    'subscription', jsonb_build_object(
      'status', _sub.status,
      'trial_ends_at', _sub.trial_ends_at,
      'current_period_start', _sub.current_period_start,
      'current_period_end', _sub.current_period_end,
      'overrides', _sub.overrides
    ),
    'balances', jsonb_build_object(
      'ai_credits_balance', coalesce(_bal.ai_credits_balance, 0),
      'ai_credits_granted_this_period', coalesce(_bal.ai_credits_granted_this_period, 0),
      'ai_credits_consumed_this_period', coalesce(_bal.ai_credits_consumed_this_period, 0),
      'money_balance_cents', coalesce(_bal.money_balance_cents, 0),
      'currency', coalesce(_bal.currency, _plan.currency)
    ),
    'limits', jsonb_build_object(
      'max_products', public.get_effective_limit(_tenant_id, 'max_products'),
      'max_orders_per_month', public.get_effective_limit(_tenant_id, 'max_orders_per_month'),
      'max_customers', public.get_effective_limit(_tenant_id, 'max_customers'),
      'max_ai_runs_per_month', public.get_effective_limit(_tenant_id, 'max_ai_runs_per_month'),
      'max_outbound_messages_per_month', public.get_effective_limit(_tenant_id, 'max_outbound_messages_per_month'),
      'max_storage_mb', public.get_effective_limit(_tenant_id, 'max_storage_mb'),
      'max_team_members', public.get_effective_limit(_tenant_id, 'max_team_members')
    ),
    'usage', jsonb_build_object(
      'products_count', public.get_current_usage(_tenant_id, 'products_count'),
      'orders_count', public.get_current_usage(_tenant_id, 'orders_count'),
      'customers_count', public.get_current_usage(_tenant_id, 'customers_count'),
      'ai_runs_count', public.get_current_usage(_tenant_id, 'ai_runs_count'),
      'outbound_messages_count', public.get_current_usage(_tenant_id, 'outbound_messages_count')
    )
  );

  RETURN _result;
END;
$$;

-- =========================================================================
-- 9. ENFORCEMENT TRIGGERS
-- =========================================================================

-- Products: enforce max_products on INSERT
CREATE OR REPLACE FUNCTION public.enforce_products_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  IF NOT public.check_plan_limit(NEW.tenant_id, 'products_count', 'max_products') THEN
    RAISE EXCEPTION 'plan_limit_exceeded:max_products' USING HINT = 'Upgrade your plan to add more products';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_enforce_limit
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_products_limit();

-- Orders: enforce + count
CREATE OR REPLACE FUNCTION public.enforce_orders_limit_and_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    IF NOT public.check_plan_limit(NEW.tenant_id, 'orders_count', 'max_orders_per_month') THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_orders_per_month';
    END IF;
  END IF;
  PERFORM public.increment_usage(NEW.tenant_id, 'orders_count', 1);
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_enforce_limit
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_orders_limit_and_count();

-- Agent runs: count + try to consume credits
CREATE OR REPLACE FUNCTION public.count_and_charge_agent_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _has_credits boolean;
BEGIN
  IF NOT public.is_super_admin() THEN
    IF NOT public.check_plan_limit(NEW.tenant_id, 'ai_runs_count', 'max_ai_runs_per_month') THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_ai_runs_per_month';
    END IF;
  END IF;
  PERFORM public.increment_usage(NEW.tenant_id, 'ai_runs_count', 1);
  -- charge 1 credit per run; if insufficient and not super-admin, fail soft (mark error)
  _has_credits := public.consume_ai_credits(NEW.tenant_id, 1,
                  'Agent run: ' || NEW.agent_id, 'agent_run', NEW.id);
  IF NOT _has_credits AND NOT public.is_super_admin() THEN
    NEW.status := 'failed';
    NEW.error := 'insufficient_ai_credits';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acos_runs_count_charge
  BEFORE INSERT ON public.acos_agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.count_and_charge_agent_run();

-- Outbound messages: count
CREATE OR REPLACE FUNCTION public.count_outbound_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.increment_usage(NEW.tenant_id, 'outbound_messages_count', 1);
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbound_count
  AFTER INSERT ON public.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.count_outbound_message();

-- Auto-provision Free plan + starting balance for new tenants
CREATE OR REPLACE FUNCTION public.bootstrap_tenant_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _free_plan public.plans;
BEGIN
  SELECT * INTO _free_plan FROM public.plans WHERE key = 'free' LIMIT 1;
  IF _free_plan.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_id)
  VALUES (NEW.id, _free_plan.id)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.tenant_balances (tenant_id) VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;

  PERFORM public.add_balance(NEW.id, 'ai_credits', _free_plan.max_ai_credits_monthly_grant,
                             'Initial Free plan grant', 'tenant_init');
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_bootstrap_subscription
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_tenant_subscription();

-- =========================================================================
-- 10. BACKFILL EXISTING TENANTS
-- =========================================================================
DO $$
DECLARE
  _t record;
  _free_plan_id uuid;
  _free_grant integer;
BEGIN
  SELECT id, max_ai_credits_monthly_grant INTO _free_plan_id, _free_grant
  FROM public.plans WHERE key = 'free';

  FOR _t IN SELECT id FROM public.tenants LOOP
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id)
    VALUES (_t.id, _free_plan_id)
    ON CONFLICT (tenant_id) DO NOTHING;

    INSERT INTO public.tenant_balances (tenant_id, ai_credits_balance, ai_credits_granted_this_period, last_grant_at)
    VALUES (_t.id, _free_grant, _free_grant, now())
    ON CONFLICT (tenant_id) DO NOTHING;

    INSERT INTO public.balance_ledger (tenant_id, kind, direction, amount, balance_after, reason, reference_kind)
    SELECT _t.id, 'ai_credits', 'credit', _free_grant, _free_grant,
           'Backfill: initial Free plan grant', 'tenant_init'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.balance_ledger WHERE tenant_id = _t.id AND reference_kind = 'tenant_init'
    );
  END LOOP;
END $$;
