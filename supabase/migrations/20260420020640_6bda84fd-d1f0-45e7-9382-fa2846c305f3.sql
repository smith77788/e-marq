-- ============================================================
-- 1. EVENT TYPE EXTENSIONS
-- ============================================================
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'inactivity_detected';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'message_sent';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'message_received';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'session_start';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'reorder_triggered';

-- ============================================================
-- 2. CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email           text,
  name            text,
  user_id         uuid,
  telegram_chat_id text,
  telegram_username text,
  lifecycle_stage text NOT NULL DEFAULT 'new',
  total_orders    integer NOT NULL DEFAULT 0,
  total_spent_cents integer NOT NULL DEFAULT 0,
  avg_order_cents integer NOT NULL DEFAULT 0,
  first_order_at  timestamptz,
  last_order_at   timestamptz,
  predicted_next_order_at timestamptz,
  avg_cycle_days  numeric,
  last_contacted_at timestamptz,
  consent_marketing boolean NOT NULL DEFAULT true,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_email_uq
  ON public.customers(tenant_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_telegram_uq
  ON public.customers(tenant_id, telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_tenant_stage_idx ON public.customers(tenant_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS customers_tenant_predicted_idx ON public.customers(tenant_id, predicted_next_order_at);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_select_tenant_or_super
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY customers_delete_super_only
  ON public.customers FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. OUTBOUND MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  channel         text NOT NULL,
  trigger_kind    text NOT NULL,
  template_key    text,
  body            text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  channel_message_id text,
  related_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  source_insight_id uuid,
  source_action_id  uuid,
  expected_impact_cents integer,
  actual_revenue_cents  integer,
  error           text,
  scheduled_for   timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  replied_at      timestamptz,
  converted_at    timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_tenant_status_idx ON public.outbound_messages(tenant_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS outbound_customer_idx ON public.outbound_messages(customer_id);

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbound_select_tenant_or_super
  ON public.outbound_messages FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE TRIGGER outbound_set_updated_at
  BEFORE UPDATE ON public.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4. CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  channel         text NOT NULL,
  external_thread_id text,
  direction       text NOT NULL,
  body            text NOT NULL,
  intent          text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_tenant_customer_idx ON public.conversations(tenant_id, customer_id, created_at DESC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_select_tenant_or_super
  ON public.conversations FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY conversations_insert_public
  ON public.conversations FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- ============================================================
-- 5. DECISION POLICIES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.decision_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  policy_key      text NOT NULL,
  value           jsonb NOT NULL,
  reason          text,
  trial_count     integer NOT NULL DEFAULT 0,
  win_count       integer NOT NULL DEFAULT 0,
  total_revenue_cents integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS decision_policies_tenant_key_uq
  ON public.decision_policies(tenant_id, policy_key) WHERE is_active = true;

ALTER TABLE public.decision_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY decision_policies_select_tenant_or_super
  ON public.decision_policies FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE TRIGGER decision_policies_set_updated_at
  BEFORE UPDATE ON public.decision_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 6. AUTO-RECOMPUTE CUSTOMER STATE FROM ORDERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_customer_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _customer_id uuid;
  _stats record;
  _avg_cycle numeric;
  _stage text;
BEGIN
  IF NEW.status <> 'paid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN RETURN NEW; END IF;
  IF NEW.customer_email IS NULL AND NEW.customer_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO _customer_id
  FROM public.customers
  WHERE tenant_id = NEW.tenant_id
    AND (
      (NEW.customer_email IS NOT NULL AND lower(email) = lower(NEW.customer_email))
      OR (NEW.customer_user_id IS NOT NULL AND user_id = NEW.customer_user_id)
    )
  LIMIT 1;

  IF _customer_id IS NULL THEN
    INSERT INTO public.customers (tenant_id, email, name, user_id)
    VALUES (NEW.tenant_id, NEW.customer_email, NEW.customer_name, NEW.customer_user_id)
    RETURNING id INTO _customer_id;
  END IF;

  SELECT
    count(*) AS cnt,
    coalesce(sum(total_cents), 0) AS sum_cents,
    min(coalesce(paid_at, created_at)) AS first_at,
    max(coalesce(paid_at, created_at)) AS last_at
  INTO _stats
  FROM public.orders
  WHERE tenant_id = NEW.tenant_id
    AND status = 'paid'
    AND (
      (NEW.customer_email IS NOT NULL AND lower(customer_email) = lower(NEW.customer_email))
      OR (NEW.customer_user_id IS NOT NULL AND customer_user_id = NEW.customer_user_id)
    );

  IF _stats.cnt >= 2 THEN
    SELECT EXTRACT(EPOCH FROM (_stats.last_at - _stats.first_at)) / 86400.0 / GREATEST(_stats.cnt - 1, 1)
      INTO _avg_cycle;
  ELSE
    _avg_cycle := NULL;
  END IF;

  IF _stats.cnt >= 5 OR _stats.sum_cents >= 50000 THEN
    _stage := 'vip';
  ELSIF _stats.cnt >= 2 THEN
    _stage := 'active';
  ELSE
    _stage := 'new';
  END IF;

  UPDATE public.customers
  SET total_orders = _stats.cnt,
      total_spent_cents = _stats.sum_cents,
      avg_order_cents = CASE WHEN _stats.cnt > 0 THEN (_stats.sum_cents / _stats.cnt)::int ELSE 0 END,
      first_order_at = _stats.first_at,
      last_order_at = _stats.last_at,
      avg_cycle_days = _avg_cycle,
      predicted_next_order_at = CASE
        WHEN _avg_cycle IS NOT NULL THEN _stats.last_at + (_avg_cycle || ' days')::interval
        ELSE NULL
      END,
      lifecycle_stage = _stage,
      email = COALESCE(email, NEW.customer_email),
      name = COALESCE(name, NEW.customer_name),
      user_id = COALESCE(user_id, NEW.customer_user_id),
      updated_at = now()
  WHERE id = _customer_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_upsert_customer ON public.orders;
CREATE TRIGGER orders_upsert_customer
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.upsert_customer_from_order();

-- ============================================================
-- 7. BACKFILL existing customers from existing paid orders
-- ============================================================
WITH agg AS (
  SELECT
    o.tenant_id,
    lower(o.customer_email) AS email_lower,
    (array_agg(o.customer_name) FILTER (WHERE o.customer_name IS NOT NULL))[1] AS name,
    (array_agg(o.customer_user_id) FILTER (WHERE o.customer_user_id IS NOT NULL))[1] AS user_id,
    count(*)::int AS cnt,
    sum(o.total_cents)::int AS sum_cents,
    min(coalesce(o.paid_at, o.created_at)) AS first_at,
    max(coalesce(o.paid_at, o.created_at)) AS last_at
  FROM public.orders o
  WHERE o.status = 'paid' AND o.customer_email IS NOT NULL
  GROUP BY o.tenant_id, lower(o.customer_email)
)
INSERT INTO public.customers (tenant_id, email, name, user_id, total_orders, total_spent_cents, avg_order_cents, first_order_at, last_order_at, lifecycle_stage)
SELECT
  agg.tenant_id,
  agg.email_lower,
  agg.name,
  agg.user_id,
  agg.cnt,
  agg.sum_cents,
  (agg.sum_cents / GREATEST(agg.cnt, 1))::int,
  agg.first_at,
  agg.last_at,
  CASE
    WHEN agg.cnt >= 5 OR agg.sum_cents >= 50000 THEN 'vip'
    WHEN agg.cnt >= 2 THEN 'active'
    ELSE 'new'
  END
FROM agg
ON CONFLICT (tenant_id, lower(email)) WHERE email IS NOT NULL
DO UPDATE SET
  total_orders = EXCLUDED.total_orders,
  total_spent_cents = EXCLUDED.total_spent_cents,
  avg_order_cents = EXCLUDED.avg_order_cents,
  first_order_at = EXCLUDED.first_order_at,
  last_order_at = EXCLUDED.last_order_at,
  lifecycle_stage = EXCLUDED.lifecycle_stage;

UPDATE public.customers c
SET avg_cycle_days = sub.cycle,
    predicted_next_order_at = c.last_order_at + (sub.cycle || ' days')::interval
FROM (
  SELECT
    c2.id,
    EXTRACT(EPOCH FROM (c2.last_order_at - c2.first_order_at)) / 86400.0 / GREATEST(c2.total_orders - 1, 1) AS cycle
  FROM public.customers c2
  WHERE c2.total_orders >= 2
    AND c2.first_order_at IS NOT NULL
    AND c2.last_order_at IS NOT NULL
) sub
WHERE c.id = sub.id;
