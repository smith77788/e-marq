
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_notif_unique_daily_briefing
  ON public.owner_notifications (tenant_id, kind, (metadata->>'briefing_date'))
  WHERE kind = 'daily_briefing';

CREATE OR REPLACE FUNCTION public.generate_owner_daily_briefing()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        AND severity = 'high'
        AND created_at >= v_day::timestamptz
        AND created_at < (v_day + 1)::timestamptz
      ORDER BY created_at DESC
      LIMIT 1;

    -- Skip empty briefings
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
        'pending_owner', v_pending_owner,
        'top_concern', v_concern),
      now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.owner_notifications n
      WHERE n.tenant_id = t.id
        AND n.kind = 'daily_briefing'
        AND n.metadata->>'briefing_date' = v_day::text
    );

    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('owner_daily_briefing'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('owner_daily_briefing', '0 8 * * *', $$ SELECT public.generate_owner_daily_briefing(); $$);
