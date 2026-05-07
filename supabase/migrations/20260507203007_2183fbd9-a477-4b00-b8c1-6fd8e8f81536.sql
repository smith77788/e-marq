CREATE OR REPLACE FUNCTION public.detect_high_ltv_at_risk()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH candidates AS (
    SELECT
      l.tenant_id, l.customer_id, l.predicted_ltv_cents,
      l.churn_probability, l.segment, c.email, c.name
    FROM customer_ltv_scores l
    JOIN customers c ON c.id = l.customer_id
    WHERE l.segment IN ('gold','platinum')
      AND l.churn_probability >= 0.5
      AND c.consent_marketing = true
  ),
  inserted AS (
    INSERT INTO ai_insights (
      tenant_id, insight_type, affected_layer, title, description, confidence,
      risk_level, status, metrics, dedup_bucket
    )
    SELECT
      cd.tenant_id,
      'high_ltv_at_risk',
      'customer',
      'High-LTV клієнт під ризиком: ' || COALESCE(cd.name, cd.email, 'клієнт'),
      'Сегмент ' || cd.segment || ', прогноз LTV ' || ROUND(cd.predicted_ltv_cents/100.0)::text
        || ' UAH, ймовірність відтоку ' || ROUND(cd.churn_probability*100)::text || '%. Рекомендований персональний winback.',
      LEAST(0.9, 0.5 + cd.churn_probability * 0.4),
      CASE WHEN cd.segment = 'platinum' THEN 'high' ELSE 'medium' END,
      'new',
      jsonb_build_object(
        'action', 'priority_winback',
        'segment', cd.segment,
        'predicted_ltv_cents', cd.predicted_ltv_cents,
        'churn_probability', cd.churn_probability,
        'customer_id', cd.customer_id
      ),
      ('x' || substr(md5('high_ltv_at_risk:' || cd.tenant_id::text || ':' || cd.customer_id::text || ':' || to_char(now(), 'IYYY-IW')), 1, 16))::bit(64)::bigint
    FROM candidates cd
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_insights ai
      WHERE ai.tenant_id = cd.tenant_id
        AND ai.insight_type = 'high_ltv_at_risk'
        AND (ai.metrics->>'customer_id') = cd.customer_id::text
        AND ai.created_at > now() - interval '7 days'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_owner_daily_briefing()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
  t RECORD;
  v_day date := CURRENT_DATE - 1;
  v_revenue_cents bigint;
  v_orders integer;
  v_top_action text;
  v_top_lift_cents bigint;
  v_concern text;
  v_pending_owner integer;
BEGIN
  FOR t IN
    SELECT id, name FROM public.tenants
    WHERE status IN ('active','pending') AND COALESCE(is_pilot,false) = false
  LOOP
    SELECT COALESCE(SUM(total_cents),0)::bigint, COUNT(*)::int
      INTO v_revenue_cents, v_orders
      FROM public.orders
      WHERE tenant_id = t.id
        AND status = 'paid'
        AND paid_at >= v_day::timestamptz
        AND paid_at < (v_day + 1)::timestamptz;

    SELECT dq.action_type, COALESCE(SUM(ao.attributed_revenue_cents),0)::bigint
      INTO v_top_action, v_top_lift_cents
      FROM public.action_outcomes ao
      JOIN public.decision_queue dq ON dq.id = ao.decision_id
      WHERE ao.tenant_id = t.id
        AND ao.measured_at >= v_day::timestamptz
        AND ao.measured_at < (v_day + 1)::timestamptz
        AND ao.attributed_revenue_cents > 0
      GROUP BY dq.action_type
      ORDER BY SUM(ao.attributed_revenue_cents) DESC
      LIMIT 1;

    SELECT COUNT(*)::int INTO v_pending_owner
      FROM public.decision_queue
      WHERE tenant_id = t.id
        AND status = 'pending'
        AND action_type IN ('owner_setup_task','owner_review','owner_review_rules','flag_for_review');

    SELECT title INTO v_concern
      FROM public.ai_insights
      WHERE tenant_id = t.id
        AND risk_level = 'high'
        AND created_at >= v_day::timestamptz
        AND created_at < (v_day + 1)::timestamptz
      ORDER BY created_at DESC
      LIMIT 1;

    IF v_revenue_cents = 0 AND v_orders = 0 AND v_top_lift_cents = 0
       AND v_pending_owner = 0 AND v_concern IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.owner_notifications
      (tenant_id, kind, severity, title, body, link, channel, metadata, created_at)
    SELECT
      t.id,
      'daily_briefing',
      'info',
      format('Daily briefing — %s', to_char(v_day, 'Mon DD')),
      format(E'Yesterday: $%s revenue across %s paid orders.\nTop action: %s%s\nPending your review: %s\n%s',
        ROUND(v_revenue_cents/100.0, 2),
        v_orders,
        COALESCE(v_top_action, 'none'),
        CASE WHEN v_top_lift_cents > 0 THEN format(' (+$%s lift)', ROUND(v_top_lift_cents/100.0, 2)) ELSE '' END,
        v_pending_owner,
        COALESCE('⚠ ' || v_concern, '')),
      '/brand/decisions',
      'in_app',
      jsonb_build_object(
        'briefing_date', v_day::text,
        'revenue_cents', v_revenue_cents,
        'orders', v_orders,
        'top_action', v_top_action,
        'top_lift_cents', v_top_lift_cents,
        'pending_owner', v_pending_owner
      ),
      now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.owner_notifications n
      WHERE n.tenant_id = t.id
        AND n.kind = 'daily_briefing'
        AND (n.metadata->>'briefing_date') = v_day::text
    );

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END LOOP;
  RETURN v_inserted;
END;
$function$;