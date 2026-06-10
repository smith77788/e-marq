
-- =============================================================================
-- SQL Agent #20: CAC Payback Agent
-- =============================================================================

-- 1. acquisition_costs: owner вводить marketing spend per month/channel
CREATE TABLE IF NOT EXISTS public.acquisition_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  channel text NOT NULL DEFAULT 'all',
  spend_cents bigint NOT NULL DEFAULT 0,
  new_customers integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_month, channel)
);

CREATE INDEX IF NOT EXISTS idx_acq_costs_tenant_month
  ON public.acquisition_costs (tenant_id, period_month DESC);

ALTER TABLE public.acquisition_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acq_costs_select" ON public.acquisition_costs
  FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));

CREATE POLICY "acq_costs_insert" ON public.acquisition_costs
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));

CREATE POLICY "acq_costs_update" ON public.acquisition_costs
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));

CREATE POLICY "acq_costs_delete" ON public.acquisition_costs
  FOR DELETE TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id));

CREATE TRIGGER trg_acq_costs_updated_at
  BEFORE UPDATE ON public.acquisition_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. cac_payback_metrics: computed by daily agent
CREATE TABLE IF NOT EXISTS public.cac_payback_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cohort_month date NOT NULL,
  channel text NOT NULL DEFAULT 'all',
  cac_cents bigint NOT NULL DEFAULT 0,
  customer_count integer NOT NULL DEFAULT 0,
  revenue_m1_cents bigint NOT NULL DEFAULT 0,
  revenue_m3_cents bigint NOT NULL DEFAULT 0,
  revenue_m6_cents bigint NOT NULL DEFAULT 0,
  revenue_m12_cents bigint NOT NULL DEFAULT 0,
  payback_month integer,                    -- NULL = not paid back yet
  ltv_12m_cents bigint NOT NULL DEFAULT 0,
  roi_pct numeric NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cohort_month, channel)
);

CREATE INDEX IF NOT EXISTS idx_cac_payback_tenant
  ON public.cac_payback_metrics (tenant_id, cohort_month DESC);

ALTER TABLE public.cac_payback_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cac_select" ON public.cac_payback_metrics
  FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));

CREATE POLICY "cac_sysinsert_block" ON public.cac_payback_metrics
  FOR INSERT TO authenticated WITH CHECK (is_super_admin());

CREATE POLICY "cac_sysupdate_block" ON public.cac_payback_metrics
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- 3. compute_cac_payback() — daily 04:35 UTC
CREATE OR REPLACE FUNCTION public.compute_cac_payback()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _processed integer := 0;
  r record;
  _rev jsonb;
  _r1 bigint; _r3 bigint; _r6 bigint; _r12 bigint;
  _payback integer;
  _i integer;
  _cum bigint;
  _cac bigint;
  _ltv12 bigint;
  _roi numeric;
BEGIN
  FOR r IN
    SELECT cc.tenant_id, cc.cohort_month, cc.customer_count, cc.revenue_curve,
           ac.channel, ac.spend_cents, ac.new_customers
    FROM public.customer_cohorts cc
    JOIN public.acquisition_costs ac
      ON ac.tenant_id = cc.tenant_id
     AND ac.period_month = cc.cohort_month
    WHERE cc.customer_count > 0
      AND ac.new_customers > 0
  LOOP
    _rev := r.revenue_curve;
    _r1  := COALESCE((_rev->1)::bigint, 0);
    _r3  := COALESCE((_rev->3)::bigint, 0);
    _r6  := COALESCE((_rev->6)::bigint, 0);
    _r12 := COALESCE((_rev->11)::bigint, COALESCE((_rev->10)::bigint, 0));

    _cac := (r.spend_cents / GREATEST(r.new_customers, 1))::bigint;

    -- per-customer cumulative; payback month = first offset where cum/cust >= cac
    _payback := NULL;
    FOR _i IN 0..LEAST(jsonb_array_length(_rev) - 1, 23) LOOP
      _cum := COALESCE((_rev->_i)::bigint, 0);
      IF r.customer_count > 0 AND (_cum / r.customer_count) >= _cac THEN
        _payback := _i;
        EXIT;
      END IF;
    END LOOP;

    _ltv12 := CASE WHEN r.customer_count > 0 THEN _r12 / r.customer_count ELSE 0 END;
    _roi := CASE WHEN _cac > 0 THEN (_ltv12::numeric / _cac::numeric - 1) * 100 ELSE 0 END;

    INSERT INTO public.cac_payback_metrics (
      tenant_id, cohort_month, channel, cac_cents, customer_count,
      revenue_m1_cents, revenue_m3_cents, revenue_m6_cents, revenue_m12_cents,
      payback_month, ltv_12m_cents, roi_pct, computed_at
    ) VALUES (
      r.tenant_id, r.cohort_month, r.channel, _cac, r.customer_count,
      _r1, _r3, _r6, _r12, _payback, _ltv12, _roi, now()
    )
    ON CONFLICT (tenant_id, cohort_month, channel) DO UPDATE SET
      cac_cents = EXCLUDED.cac_cents,
      customer_count = EXCLUDED.customer_count,
      revenue_m1_cents = EXCLUDED.revenue_m1_cents,
      revenue_m3_cents = EXCLUDED.revenue_m3_cents,
      revenue_m6_cents = EXCLUDED.revenue_m6_cents,
      revenue_m12_cents = EXCLUDED.revenue_m12_cents,
      payback_month = EXCLUDED.payback_month,
      ltv_12m_cents = EXCLUDED.ltv_12m_cents,
      roi_pct = EXCLUDED.roi_pct,
      computed_at = now();

    _processed := _processed + 1;
  END LOOP;

  RETURN _processed;
END $$;

-- 4. detect_cac_signals() — hourly :42, emits insights
CREATE OR REPLACE FUNCTION public.detect_cac_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _emitted integer := 0;
  r record;
  _is_pilot boolean;
BEGIN
  FOR r IN
    SELECT m.tenant_id, m.cohort_month, m.channel, m.cac_cents, m.payback_month,
           m.ltv_12m_cents, m.roi_pct, m.customer_count
    FROM public.cac_payback_metrics m
    WHERE m.cohort_month >= (CURRENT_DATE - INTERVAL '6 months')::date
      AND m.computed_at > now() - INTERVAL '36 hours'
  LOOP
    SELECT is_pilot INTO _is_pilot FROM public.tenants WHERE id = r.tenant_id;
    IF _is_pilot IS TRUE THEN CONTINUE; END IF;

    -- Slow payback / unprofitable
    IF (r.payback_month IS NULL OR r.payback_month > 6) AND r.cac_cents > 0 THEN
      INSERT INTO public.ai_insights (
        tenant_id, insight_type, affected_layer, title, description,
        expected_impact, confidence, risk_level, metrics, status, source_agent_id
      ) VALUES (
        r.tenant_id, 'cac_payback_slow', 'finance',
        'Когорта ' || to_char(r.cohort_month, 'Mon YYYY') || ' окуповується повільно',
        'CAC ' || (r.cac_cents/100.0)::text || ' грн, LTV(12м) ' || (r.ltv_12m_cents/100.0)::text || ' грн на клієнта (' || r.channel || '). ROI ' || round(r.roi_pct,1)::text || '%.',
        'Перегляньте канал acquisition: знизити spend або змінити креатив.',
        0.7, 'medium',
        jsonb_build_object('cohort_month', r.cohort_month, 'channel', r.channel,
                           'cac_cents', r.cac_cents, 'ltv_12m_cents', r.ltv_12m_cents,
                           'payback_month', r.payback_month, 'roi_pct', r.roi_pct),
        'open', 'cac_payback_agent'
      )
      ON CONFLICT DO NOTHING;
      _emitted := _emitted + 1;
    END IF;

    -- Winner channel
    IF r.roi_pct >= 200 AND r.customer_count >= 5 THEN
      INSERT INTO public.ai_insights (
        tenant_id, insight_type, affected_layer, title, description,
        expected_impact, confidence, risk_level, metrics, status, source_agent_id
      ) VALUES (
        r.tenant_id, 'cac_winner_channel', 'finance',
        'Канал "' || r.channel || '" дає ROI ' || round(r.roi_pct,0)::text || '% (когорта ' || to_char(r.cohort_month, 'Mon YYYY') || ')',
        'LTV(12м) ' || (r.ltv_12m_cents/100.0)::text || ' грн при CAC ' || (r.cac_cents/100.0)::text || ' грн. Розгляньте збільшення budget.',
        'Збільшити marketing spend на цей канал — кожен +1 грн повертає ' || round(r.roi_pct/100 + 1, 2)::text || ' грн за рік.',
        0.75, 'low',
        jsonb_build_object('cohort_month', r.cohort_month, 'channel', r.channel,
                           'cac_cents', r.cac_cents, 'ltv_12m_cents', r.ltv_12m_cents,
                           'roi_pct', r.roi_pct),
        'open', 'cac_payback_agent'
      )
      ON CONFLICT DO NOTHING;
      _emitted := _emitted + 1;
    END IF;
  END LOOP;

  RETURN _emitted;
END $$;

-- 5. Cron jobs
DO $$
DECLARE _cron_secret text := COALESCE(current_setting('app.cron_secret', true), '');
BEGIN
  PERFORM cron.unschedule('compute-cac-payback-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'compute-cac-payback-daily',
  '35 4 * * *',
  $$ SELECT public.compute_cac_payback(); $$
);

DO $$
BEGIN
  PERFORM cron.unschedule('detect-cac-signals-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'detect-cac-signals-hourly',
  '42 * * * *',
  $$ SELECT public.detect_cac_signals(); $$
);

-- =============================================================================
-- Notification Digest dedup: batch same-kind notifications within 60min
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_owner_telegram(_tenant_id uuid, _kind text, _source_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _chat text;
  _app_url text := 'https://e-marq.lovable.app';
  _anon_key text := '<SUPABASE_PUBLISHABLE_KEY>';
  _existing_id uuid;
  _notif_kind text;
  _notif_title text;
BEGIN
  SELECT owner_telegram_chat_id INTO _chat FROM public.tenant_configs WHERE tenant_id = _tenant_id;
  IF _chat IS NULL OR _chat = '' THEN RETURN; END IF;

  -- Batching only for 'notification' source_kind: group by underlying notification.kind within 60min
  IF _kind = 'notification' THEN
    SELECT n.kind, n.title INTO _notif_kind, _notif_title
    FROM public.owner_notifications n WHERE n.id = _source_id;

    SELECT o.id INTO _existing_id
    FROM public.owner_telegram_outbox o
    WHERE o.tenant_id = _tenant_id
      AND o.source_kind = 'notification'
      AND o.status = 'pending'
      AND o.created_at > now() - INTERVAL '60 minutes'
      AND COALESCE(o.payload->>'notif_kind', '') = COALESCE(_notif_kind, '')
    ORDER BY o.created_at DESC
    LIMIT 1;

    IF _existing_id IS NOT NULL THEN
      UPDATE public.owner_telegram_outbox
      SET payload = jsonb_set(
            jsonb_set(
              COALESCE(payload, '{}'::jsonb),
              '{batched_count}',
              to_jsonb(COALESCE((payload->>'batched_count')::int, 1) + 1)
            ),
            '{batched_titles}',
            COALESCE(payload->'batched_titles', '[]'::jsonb)
              || to_jsonb(_notif_title)
          )
      WHERE id = _existing_id;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.owner_telegram_outbox (tenant_id, source_kind, source_id, chat_id, payload)
  VALUES (
    _tenant_id, _kind, _source_id, _chat,
    CASE WHEN _kind = 'notification'
      THEN jsonb_build_object(
        'notif_kind', _notif_kind,
        'batched_count', 1,
        'batched_titles', jsonb_build_array(_notif_title)
      )
      ELSE '{}'::jsonb
    END
  )
  ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING;

  BEGIN
    PERFORM net.http_post(
      url := _app_url || '/hooks/telegram/notify-owner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _anon_key
      ),
      body := jsonb_build_object('tenant_id', _tenant_id, 'kind', _kind, 'source_id', _source_id)
    );
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;
