
-- Phase 5: Signal layer + decision/outcome loop

CREATE TABLE IF NOT EXISTS public.product_metrics_14d (
  tenant_id uuid NOT NULL, product_id uuid NOT NULL,
  window_start date NOT NULL, window_end date NOT NULL,
  units_sold int NOT NULL DEFAULT 0, revenue_cents bigint NOT NULL DEFAULT 0,
  orders_count int NOT NULL DEFAULT 0,
  views int NOT NULL DEFAULT 0, add_to_cart int NOT NULL DEFAULT 0,
  conversion_rate numeric(6,4) NOT NULL DEFAULT 0,
  current_stock int, is_stocked_out boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_pm14_tenant_revenue ON public.product_metrics_14d (tenant_id, revenue_cents DESC);
ALTER TABLE public.product_metrics_14d ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pm14 tenant read" ON public.product_metrics_14d FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "pm14 service write" ON public.product_metrics_14d FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.customer_metrics_30d (
  tenant_id uuid NOT NULL, customer_id uuid NOT NULL,
  window_start date NOT NULL, window_end date NOT NULL,
  orders_30d int NOT NULL DEFAULT 0, revenue_30d_cents bigint NOT NULL DEFAULT 0,
  last_order_at timestamptz, days_since_last int,
  avg_order_cents bigint NOT NULL DEFAULT 0,
  churn_risk numeric(4,3) NOT NULL DEFAULT 0,
  lifecycle_stage text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_cm30_tenant_churn ON public.customer_metrics_30d (tenant_id, churn_risk DESC);
ALTER TABLE public.customer_metrics_30d ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cm30 tenant read" ON public.customer_metrics_30d FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "cm30 service write" ON public.customer_metrics_30d FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.funnel_metrics_14d (
  tenant_id uuid NOT NULL, day date NOT NULL,
  visits int NOT NULL DEFAULT 0, product_views int NOT NULL DEFAULT 0,
  add_to_cart int NOT NULL DEFAULT 0, checkout int NOT NULL DEFAULT 0,
  paid_orders int NOT NULL DEFAULT 0, revenue_cents bigint NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day)
);
ALTER TABLE public.funnel_metrics_14d ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fm14 tenant read" ON public.funnel_metrics_14d FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "fm14 service write" ON public.funnel_metrics_14d FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN
  CREATE TYPE public.decision_status AS ENUM ('pending','approved','executing','done','rejected','expired','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.decision_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  insight_id uuid REFERENCES public.ai_insights(id) ON DELETE SET NULL,
  agent_id text NOT NULL,
  action_type text NOT NULL,
  title text NOT NULL,
  rationale text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.decision_status NOT NULL DEFAULT 'pending',
  confidence numeric(4,3) NOT NULL DEFAULT 0.5,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  batch_id uuid,
  requires_approval boolean NOT NULL DEFAULT true,
  approved_by uuid, approved_at timestamptz,
  rejected_reason text,
  executed_at timestamptz, executor_action_id uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dq_tenant_status ON public.decision_queue (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dq_batch ON public.decision_queue (batch_id);
ALTER TABLE public.decision_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dq tenant read" ON public.decision_queue FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "dq tenant approve" ON public.decision_queue FOR UPDATE TO authenticated USING (public.is_tenant_admin(tenant_id)) WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "dq service write" ON public.decision_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_dq_updated_at BEFORE UPDATE ON public.decision_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.action_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  decision_id uuid REFERENCES public.decision_queue(id) ON DELETE CASCADE,
  action_id uuid,
  agent_id text NOT NULL,
  action_type text NOT NULL,
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual jsonb NOT NULL DEFAULT '{}'::jsonb,
  delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributed_revenue_cents bigint NOT NULL DEFAULT 0,
  success boolean,
  measurement_window text NOT NULL DEFAULT '7d',
  measured_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE INDEX IF NOT EXISTS idx_ao_tenant_agent ON public.action_outcomes (tenant_id, agent_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ao_decision ON public.action_outcomes (decision_id);
ALTER TABLE public.action_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ao tenant read" ON public.action_outcomes FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "ao service write" ON public.action_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.refresh_product_metrics_14d(_tenant uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  WITH sales AS (
    SELECT oi.tenant_id, oi.product_id,
      SUM(oi.quantity)::int AS units_sold,
      SUM(oi.quantity * oi.unit_price_cents)::bigint AS revenue_cents,
      COUNT(DISTINCT oi.order_id)::int AS orders_count
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.tenant_id = _tenant
      AND o.created_at >= now() - interval '14 days'
      AND o.status::text IN ('paid','fulfilled','shipped','delivered','completed')
    GROUP BY oi.tenant_id, oi.product_id
  ),
  ev AS (
    SELECT tenant_id, product_id,
      COUNT(*) FILTER (WHERE type::text = 'product_view')::int AS views,
      COUNT(*) FILTER (WHERE type::text = 'add_to_cart')::int AS add_to_cart
    FROM public.events
    WHERE tenant_id = _tenant AND product_id IS NOT NULL
      AND created_at >= now() - interval '14 days'
    GROUP BY tenant_id, product_id
  )
  INSERT INTO public.product_metrics_14d
    (tenant_id, product_id, window_start, window_end, units_sold, revenue_cents, orders_count,
     views, add_to_cart, conversion_rate, current_stock, is_stocked_out, computed_at)
  SELECT p.tenant_id, p.id, (current_date - 13)::date, current_date,
    COALESCE(s.units_sold,0), COALESCE(s.revenue_cents,0), COALESCE(s.orders_count,0),
    COALESCE(e.views,0), COALESCE(e.add_to_cart,0),
    CASE WHEN COALESCE(e.views,0) > 0 THEN ROUND(COALESCE(s.units_sold,0)::numeric / e.views, 4) ELSE 0 END,
    p.stock, COALESCE(p.stock,0) <= 0, now()
  FROM public.products p
  LEFT JOIN sales s ON s.product_id = p.id
  LEFT JOIN ev e ON e.product_id = p.id
  WHERE p.tenant_id = _tenant
  ON CONFLICT (tenant_id, product_id) DO UPDATE SET
    window_start=EXCLUDED.window_start, window_end=EXCLUDED.window_end,
    units_sold=EXCLUDED.units_sold, revenue_cents=EXCLUDED.revenue_cents,
    orders_count=EXCLUDED.orders_count, views=EXCLUDED.views,
    add_to_cart=EXCLUDED.add_to_cart, conversion_rate=EXCLUDED.conversion_rate,
    current_stock=EXCLUDED.current_stock, is_stocked_out=EXCLUDED.is_stocked_out,
    computed_at=now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_customer_metrics_30d(_tenant uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  WITH agg AS (
    SELECT o.tenant_id, c.id AS customer_id,
      COUNT(*) FILTER (WHERE o.created_at >= now() - interval '30 days'
        AND o.status::text IN ('paid','fulfilled','shipped','delivered','completed'))::int AS orders_30d,
      COALESCE(SUM(o.total_cents) FILTER (WHERE o.created_at >= now() - interval '30 days'
        AND o.status::text IN ('paid','fulfilled','shipped','delivered','completed')),0)::bigint AS revenue_30d_cents,
      MAX(o.created_at) AS last_order_at
    FROM public.customers c
    LEFT JOIN public.orders o
      ON o.tenant_id = c.tenant_id
     AND (o.customer_user_id = c.user_id OR o.customer_email = c.email)
    WHERE c.tenant_id = _tenant
    GROUP BY o.tenant_id, c.id
  )
  INSERT INTO public.customer_metrics_30d
    (tenant_id, customer_id, window_start, window_end, orders_30d, revenue_30d_cents,
     last_order_at, days_since_last, avg_order_cents, churn_risk, lifecycle_stage, computed_at)
  SELECT _tenant, a.customer_id, (current_date - 29)::date, current_date,
    a.orders_30d, a.revenue_30d_cents, a.last_order_at,
    CASE WHEN a.last_order_at IS NULL THEN NULL ELSE EXTRACT(day FROM now() - a.last_order_at)::int END,
    CASE WHEN a.orders_30d > 0 THEN (a.revenue_30d_cents / a.orders_30d) ELSE 0 END,
    CASE
      WHEN a.last_order_at IS NULL THEN 0.5
      WHEN a.last_order_at < now() - interval '90 days' THEN 0.9
      WHEN a.last_order_at < now() - interval '60 days' THEN 0.7
      WHEN a.last_order_at < now() - interval '30 days' THEN 0.4
      ELSE 0.1
    END,
    c.lifecycle_stage, now()
  FROM agg a
  JOIN public.customers c ON c.id = a.customer_id
  ON CONFLICT (tenant_id, customer_id) DO UPDATE SET
    window_start=EXCLUDED.window_start, window_end=EXCLUDED.window_end,
    orders_30d=EXCLUDED.orders_30d, revenue_30d_cents=EXCLUDED.revenue_30d_cents,
    last_order_at=EXCLUDED.last_order_at, days_since_last=EXCLUDED.days_since_last,
    avg_order_cents=EXCLUDED.avg_order_cents, churn_risk=EXCLUDED.churn_risk,
    lifecycle_stage=EXCLUDED.lifecycle_stage, computed_at=now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_funnel_metrics_14d(_tenant uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  WITH days AS (SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS d),
  ev AS (
    SELECT date_trunc('day', created_at)::date AS d,
      COUNT(*) FILTER (WHERE type::text = 'page_view')::int AS visits,
      COUNT(*) FILTER (WHERE type::text = 'product_view')::int AS product_views,
      COUNT(*) FILTER (WHERE type::text = 'add_to_cart')::int AS add_to_cart,
      COUNT(*) FILTER (WHERE type::text = 'checkout_started')::int AS checkout
    FROM public.events
    WHERE tenant_id = _tenant AND created_at >= current_date - 13
    GROUP BY 1
  ),
  ord AS (
    SELECT date_trunc('day', created_at)::date AS d,
      COUNT(*)::int AS paid_orders,
      COALESCE(SUM(total_cents),0)::bigint AS revenue_cents
    FROM public.orders
    WHERE tenant_id = _tenant AND created_at >= current_date - 13
      AND status::text IN ('paid','fulfilled','shipped','delivered','completed')
    GROUP BY 1
  )
  INSERT INTO public.funnel_metrics_14d
    (tenant_id, day, visits, product_views, add_to_cart, checkout, paid_orders, revenue_cents, computed_at)
  SELECT _tenant, days.d,
    COALESCE(ev.visits,0), COALESCE(ev.product_views,0), COALESCE(ev.add_to_cart,0),
    COALESCE(ev.checkout,0), COALESCE(ord.paid_orders,0), COALESCE(ord.revenue_cents,0), now()
  FROM days
  LEFT JOIN ev ON ev.d = days.d
  LEFT JOIN ord ON ord.d = days.d
  ON CONFLICT (tenant_id, day) DO UPDATE SET
    visits=EXCLUDED.visits, product_views=EXCLUDED.product_views,
    add_to_cart=EXCLUDED.add_to_cart, checkout=EXCLUDED.checkout,
    paid_orders=EXCLUDED.paid_orders, revenue_cents=EXCLUDED.revenue_cents, computed_at=now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_all_signal_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _result jsonb := '[]'::jsonb; _pm int; _cm int; _fm int;
BEGIN
  FOR _t IN SELECT id FROM public.tenants WHERE COALESCE(is_active, true) = true LOOP
    BEGIN
      _pm := public.refresh_product_metrics_14d(_t.id);
      _cm := public.refresh_customer_metrics_30d(_t.id);
      _fm := public.refresh_funnel_metrics_14d(_t.id);
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'pm14', _pm, 'cm30', _cm, 'fm14', _fm);
    EXCEPTION WHEN OTHERS THEN
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN _result;
END $$;
