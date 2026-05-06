CREATE OR REPLACE FUNCTION public.detect_discount_effectiveness()
RETURNS TABLE(out_tenant_id uuid, out_signals_emitted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant record;
  v_dec record;
  v_emitted int;
  v_discount_pct numeric;
  v_units int;
  v_revenue_cents bigint;
  v_cogs_cents bigint;
  v_actual_margin_cents bigint;
  v_expected_margin_cents bigint;
  v_ratio numeric;
  v_dedup_bucket bigint;
  v_severity text;
  v_insight_type text;
  v_action text;
  v_title text;
  v_week_start date;
BEGIN
  FOR v_tenant IN
    SELECT t.id FROM public.tenants t
    WHERE t.status IN ('active','pending')
      AND COALESCE(t.is_pilot,false) = false
  LOOP
    v_emitted := 0;

    FOR v_dec IN
      SELECT d.id AS decision_id,
             d.tenant_id,
             d.action_type,
             d.payload,
             ao.attributed_revenue_cents,
             d.executed_at
      FROM public.decision_queue d
      JOIN public.action_outcomes ao ON ao.decision_id = d.id
      WHERE d.tenant_id = v_tenant.id
        AND d.status = 'done'
        AND d.action_type IN ('discount_dead_stock','price_adjust')
        AND d.executed_at >= now() - interval '14 days'
        AND ao.attributed_revenue_cents IS NOT NULL
        AND ao.attributed_revenue_cents > 0
    LOOP
      v_discount_pct := COALESCE((v_dec.payload->>'discount_pct')::numeric, 0) / 100.0;
      IF v_discount_pct <= 0 OR v_discount_pct >= 1 THEN CONTINUE; END IF;

      v_units := COALESCE((v_dec.payload->>'expected_units')::int, 0);
      v_revenue_cents := v_dec.attributed_revenue_cents;

      SELECT pe.cogs_cents INTO v_cogs_cents
      FROM public.product_economics pe
      WHERE pe.product_id = (v_dec.payload->>'product_id')::uuid
      LIMIT 1;

      IF v_cogs_cents IS NULL OR v_cogs_cents <= 0 THEN CONTINUE; END IF;

      -- approximate units sold from revenue if expected_units missing
      IF v_units <= 0 THEN
        v_units := GREATEST(1, (v_revenue_cents / NULLIF(v_cogs_cents * 2, 0))::int);
      END IF;

      v_actual_margin_cents := v_revenue_cents - (v_cogs_cents * v_units);
      v_expected_margin_cents := (v_revenue_cents * (1 - v_discount_pct))::bigint - (v_cogs_cents * v_units);

      IF v_expected_margin_cents <= 0 THEN CONTINUE; END IF;

      v_ratio := v_actual_margin_cents::numeric / NULLIF(v_expected_margin_cents, 0);

      v_insight_type := NULL;
      IF v_actual_margin_cents < 0 THEN
        v_insight_type := 'discount_loss_maker';
        v_severity := 'high';
        v_action := 'owner_review_rules';
        v_title := 'Знижка спрацювала у збиток';
      ELSIF v_ratio < 0.5 THEN
        v_insight_type := 'discount_underperforming';
        v_severity := 'medium';
        v_action := 'owner_review_rules';
        v_title := 'Знижка дала менше маржі ніж очікувалось';
      END IF;

      IF v_insight_type IS NULL THEN CONTINUE; END IF;

      v_week_start := date_trunc('week', v_dec.executed_at)::date;
      v_dedup_bucket := ('x'||substr(md5(
        v_tenant.id::text || ':' || v_insight_type || ':' ||
        COALESCE(v_dec.payload->>'product_id','-') || ':' || v_week_start::text
      ), 1, 15))::bit(60)::bigint;

      IF EXISTS (
        SELECT 1 FROM public.ai_insights
        WHERE tenant_id = v_tenant.id
          AND dedup_bucket = v_dedup_bucket
          AND created_at >= now() - interval '14 days'
      ) THEN CONTINUE; END IF;

      INSERT INTO public.ai_insights(
        tenant_id, insight_type, severity, title, description, payload, dedup_bucket, status, agent_id
      ) VALUES (
        v_tenant.id,
        v_insight_type,
        v_severity,
        v_title,
        format('Знижка %s%% на товар принесла маржу %s грн (очікувалось %s грн).',
          round(v_discount_pct*100)::int,
          round(v_actual_margin_cents/100.0)::int,
          round(v_expected_margin_cents/100.0)::int),
        jsonb_build_object(
          'action', v_action,
          'product_id', v_dec.payload->>'product_id',
          'decision_id', v_dec.decision_id,
          'discount_pct', round(v_discount_pct*100)::int,
          'actual_margin_cents', v_actual_margin_cents,
          'expected_margin_cents', v_expected_margin_cents,
          'ratio', round(v_ratio, 3),
          'attributed_revenue_cents', v_revenue_cents,
          'units_estimated', v_units
        ),
        v_dedup_bucket,
        'open',
        'discount_effectiveness_monitor'
      );

      v_emitted := v_emitted + 1;
    END LOOP;

    out_tenant_id := v_tenant.id;
    out_signals_emitted := v_emitted;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Pure-SQL cron, no HTTP
SELECT cron.schedule(
  'detect-discount-effectiveness-daily',
  '30 6 * * *',
  $$ SELECT public.detect_discount_effectiveness(); $$
);
