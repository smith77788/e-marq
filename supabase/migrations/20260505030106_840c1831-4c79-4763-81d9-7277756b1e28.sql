
CREATE TABLE IF NOT EXISTS public.product_economics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  cogs_cents integer NOT NULL,
  target_margin_pct numeric NOT NULL DEFAULT 30.0,
  min_margin_pct numeric NOT NULL DEFAULT 10.0,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_economics_unique UNIQUE (tenant_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_economics_tenant ON public.product_economics(tenant_id);

ALTER TABLE public.product_economics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_read_economics" ON public.product_economics
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_memberships tm
            WHERE tm.tenant_id = product_economics.tenant_id
              AND tm.user_id = auth.uid())
  );

CREATE POLICY "tenant_admins_write_economics" ON public.product_economics
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tenant_memberships tm
            WHERE tm.tenant_id = product_economics.tenant_id
              AND tm.user_id = auth.uid()
              AND tm.role IN ('owner','admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tenant_memberships tm
            WHERE tm.tenant_id = product_economics.tenant_id
              AND tm.user_id = auth.uid()
              AND tm.role IN ('owner','admin'))
  );

CREATE POLICY "service_role_all_economics" ON public.product_economics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Estimator: given product price + cogs + discount %, returns post-discount margin %
CREATE OR REPLACE FUNCTION public.estimate_post_discount_margin_pct(_product_id uuid, _discount_pct numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.price_cents IS NULL OR p.price_cents = 0 OR pe.cogs_cents IS NULL THEN NULL
    ELSE ROUND(
      ((p.price_cents * (1 - COALESCE(_discount_pct,0)/100.0) - pe.cogs_cents)
       / GREATEST(p.price_cents * (1 - COALESCE(_discount_pct,0)/100.0), 1) * 100.0)::numeric,
      2)
  END
  FROM public.products p
  JOIN public.product_economics pe
    ON pe.product_id = p.id AND pe.tenant_id = p.tenant_id
  WHERE p.id = _product_id;
$$;

-- Patch auto_approve to add margin guardrail
CREATE OR REPLACE FUNCTION public.auto_approve_eligible_decisions()
RETURNS TABLE(approved_count integer, by_action jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_approved int := 0;
  v_breakdown jsonb := '{}'::jsonb;
  d RECORD;
  v_history_succ int;
  v_history_total int;
  v_min_succ int;
  v_bootstrap_cap int := 3;
  v_mode text;
  v_key text;
  v_used int;
  v_counters jsonb := '{}'::jsonb;
  v_tenant_daily_count int;
  v_tenant_daily_cap int := 20;
  v_tenant_daily jsonb := '{}'::jsonb;
  v_expected bigint;
  v_confidence numeric;
  v_skip_reason text;
  v_high_value_threshold bigint := 50000;
  v_min_confidence numeric := 0.4;
  v_max_mape numeric := 150.0;
  v_mape numeric;
  v_holdout_pct numeric := 0.10;
  v_is_holdout boolean;
  v_product_id uuid;
  v_discount_pct numeric;
  v_post_margin numeric;
  v_min_margin numeric;
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.action_type, dq.created_at, dq.payload,
           COALESCE((dq.payload->'forecast'->>'expected_revenue_cents')::bigint, 0) AS forecast_value,
           COALESCE((dq.payload->'forecast'->>'confidence')::numeric, 0) AS forecast_conf
      FROM public.decision_queue dq
      JOIN public.auto_approval_policy p
        ON p.action_type = dq.action_type AND p.enabled = true
     WHERE dq.status = 'pending'
       AND dq.created_at > now() - (p.max_age_hours || ' hours')::interval
       AND COALESCE((dq.payload->>'requires_owner')::bool, false) = false
     ORDER BY
       COALESCE((dq.payload->'forecast'->>'expected_revenue_cents')::bigint, 0) DESC,
       dq.created_at ASC
  LOOP
    v_expected := d.forecast_value;
    v_confidence := d.forecast_conf;
    v_skip_reason := NULL;

    IF v_expected >= v_high_value_threshold AND v_confidence < v_min_confidence THEN
      v_skip_reason := 'high_value_low_confidence';
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT mape_pct INTO v_mape
        FROM public.forecast_calibration
       WHERE tenant_id = d.tenant_id AND action_type = d.action_type
         AND computed_at > now() - interval '7 days'
       ORDER BY computed_at DESC LIMIT 1;
      IF v_mape IS NOT NULL AND v_mape > v_max_mape THEN
        v_skip_reason := 'forecast_uncalibrated';
      END IF;
    END IF;

    -- Margin guardrail for discount/price actions
    IF v_skip_reason IS NULL AND d.action_type IN ('discount_dead_stock','price_adjust') THEN
      v_product_id := COALESCE(
        (d.payload->>'product_id')::uuid,
        (d.payload->'target'->>'product_id')::uuid
      );
      v_discount_pct := COALESCE(
        (d.payload->>'discount_pct')::numeric,
        (d.payload->'parameters'->>'discount_pct')::numeric,
        (d.payload->>'price_drop_pct')::numeric,
        0
      );
      IF v_product_id IS NOT NULL THEN
        v_post_margin := public.estimate_post_discount_margin_pct(v_product_id, v_discount_pct);
        SELECT min_margin_pct INTO v_min_margin
          FROM public.product_economics
         WHERE tenant_id = d.tenant_id AND product_id = v_product_id;
        IF v_post_margin IS NOT NULL AND v_min_margin IS NOT NULL AND v_post_margin < v_min_margin THEN
          v_skip_reason := 'margin_below_target';
        END IF;
      END IF;
    END IF;

    IF v_skip_reason IS NULL THEN
      v_key := d.tenant_id::text;
      IF NOT (v_tenant_daily ? v_key) THEN
        SELECT count(*) INTO v_tenant_daily_count
          FROM public.decision_queue
         WHERE tenant_id = d.tenant_id
           AND approved_by_auto = true
           AND approved_at > now() - interval '24h';
        v_tenant_daily := jsonb_set(v_tenant_daily, ARRAY[v_key], to_jsonb(v_tenant_daily_count));
      END IF;
      v_tenant_daily_count := (v_tenant_daily->>v_key)::int;
      IF v_tenant_daily_count >= v_tenant_daily_cap THEN
        v_skip_reason := 'daily_cap_reached';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      UPDATE public.decision_queue
         SET payload = COALESCE(payload,'{}'::jsonb) ||
                       jsonb_build_object('auto_approval_skip_reason', v_skip_reason,
                                          'auto_approval_skipped_at', now(),
                                          'post_discount_margin_pct', v_post_margin)
       WHERE id = d.id
         AND COALESCE(payload->>'auto_approval_skip_reason','') IS DISTINCT FROM v_skip_reason;
      CONTINUE;
    END IF;

    SELECT min_success_history INTO v_min_succ
      FROM public.auto_approval_policy WHERE action_type = d.action_type;

    SELECT count(*) FILTER (WHERE success=true), count(*)
      INTO v_history_succ, v_history_total
      FROM public.action_outcomes
     WHERE tenant_id = d.tenant_id AND action_type = d.action_type;

    v_mode := NULL;
    IF v_history_succ >= v_min_succ THEN
      v_mode := 'history';
    ELSIF v_history_total = 0 THEN
      v_key := d.tenant_id::text || '/' || d.action_type;
      IF NOT (v_counters ? v_key) THEN
        SELECT count(*) INTO v_used
          FROM public.decision_queue
         WHERE tenant_id = d.tenant_id
           AND action_type = d.action_type
           AND approved_by_auto = true
           AND payload->>'approval_mode' = 'bootstrap';
        v_counters := jsonb_set(v_counters, ARRAY[v_key], to_jsonb(v_used));
      END IF;
      v_used := (v_counters->>v_key)::int;
      IF v_used < v_bootstrap_cap THEN
        v_mode := 'bootstrap';
        v_counters := jsonb_set(v_counters, ARRAY[v_key], to_jsonb(v_used + 1));
      END IF;
    END IF;

    IF v_mode IS NULL THEN
      CONTINUE;
    END IF;

    v_is_holdout := (random() < v_holdout_pct);

    IF v_is_holdout THEN
      UPDATE public.decision_queue
         SET status = 'rejected',
             rejected_reason = 'causal_holdout',
             payload = COALESCE(payload,'{}'::jsonb) ||
                       jsonb_build_object('holdout', true,
                                          'holdout_assigned_at', now(),
                                          'approval_mode', v_mode),
             updated_at = now()
       WHERE id = d.id;
    ELSE
      UPDATE public.decision_queue
         SET status = 'approved',
             approved_at = now(),
             approved_by_auto = true,
             payload = COALESCE(payload,'{}'::jsonb) ||
                       jsonb_build_object('approval_mode', v_mode,
                                          'holdout', false),
             updated_at = now()
       WHERE id = d.id;
      v_approved := v_approved + 1;
      v_breakdown := jsonb_set(
        v_breakdown,
        ARRAY[d.action_type],
        to_jsonb(COALESCE((v_breakdown->>d.action_type)::int, 0) + 1)
      );
      v_tenant_daily := jsonb_set(v_tenant_daily, ARRAY[d.tenant_id::text],
                                  to_jsonb(v_tenant_daily_count + 1));
    END IF;
  END LOOP;

  approved_count := v_approved;
  by_action := v_breakdown;
  RETURN NEXT;
END;
$function$;
