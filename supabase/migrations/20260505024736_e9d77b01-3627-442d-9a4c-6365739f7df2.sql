
-- Allow weekly_digest dedup per tenant per week
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_notif_unique_weekly_digest
  ON public.owner_notifications (tenant_id, kind, ((metadata->>'week_start')))
  WHERE kind = 'weekly_digest';

CREATE OR REPLACE FUNCTION public.generate_owner_weekly_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant RECORD;
  v_week_start date := (date_trunc('week', now() AT TIME ZONE 'UTC'))::date - 7;
  v_week_end   date := (date_trunc('week', now() AT TIME ZONE 'UTC'))::date;
  v_decisions_total int;
  v_decisions_done int;
  v_outcomes_count int;
  v_outcomes_succ int;
  v_lift_cents bigint;
  v_pending_owner int;
  v_top_actions jsonb;
  v_title text;
  v_body text;
  v_inserted int := 0;
  v_skipped  int := 0;
BEGIN
  FOR v_tenant IN
    SELECT id, name, slug
      FROM public.tenants
     WHERE status IN ('active','pending')
       AND COALESCE(is_pilot, false) = false
  LOOP
    -- Decisions activity in week
    SELECT count(*),
           count(*) FILTER (WHERE status = 'done')
      INTO v_decisions_total, v_decisions_done
      FROM public.decision_queue
     WHERE tenant_id = v_tenant.id
       AND created_at >= v_week_start
       AND created_at <  v_week_end;

    -- Outcomes measured this week
    SELECT count(*),
           count(*) FILTER (WHERE success = true),
           COALESCE(SUM(attributed_revenue_cents), 0)::bigint
      INTO v_outcomes_count, v_outcomes_succ, v_lift_cents
      FROM public.action_outcomes
     WHERE tenant_id = v_tenant.id
       AND measured_at >= v_week_start
       AND measured_at <  v_week_end;

    -- Currently pending owner-facing decisions
    SELECT count(*) INTO v_pending_owner
      FROM public.decision_queue
     WHERE tenant_id = v_tenant.id
       AND status = 'pending'
       AND action_type IN ('owner_setup_task','owner_review','owner_review_rules','flag_for_review');

    -- Skip if nothing happened AND nothing pending
    IF v_decisions_total = 0 AND v_outcomes_count = 0 AND v_pending_owner = 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Top 3 action types by attributed revenue this week
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'action_type', action_type,
              'count', n,
              'revenue_cents', rev,
              'win_pct', win_pct
            )), '[]'::jsonb)
      INTO v_top_actions
      FROM (
        SELECT d.action_type,
               count(*)::int AS n,
               COALESCE(SUM(ao.attributed_revenue_cents),0)::bigint AS rev,
               ROUND(100.0 * AVG(CASE WHEN ao.success THEN 1 ELSE 0 END)::numeric, 1) AS win_pct
          FROM public.action_outcomes ao
          JOIN public.decision_queue d ON d.id = ao.decision_id
         WHERE ao.tenant_id = v_tenant.id
           AND ao.measured_at >= v_week_start
           AND ao.measured_at <  v_week_end
         GROUP BY d.action_type
         ORDER BY rev DESC, n DESC
         LIMIT 3
      ) t;

    v_title := format('📊 ACOS Weekly Digest — %s', to_char(v_week_start, 'Mon DD'));
    v_body  := format(
      E'За тиждень %s — %s:\n• Рішень створено: %s (виконано: %s)\n• Виміряно outcomes: %s (успішних: %s)\n• Приписаний lift: $%s\n• Очікують вашої уваги: %s',
      to_char(v_week_start, 'Mon DD'),
      to_char(v_week_end - 1, 'Mon DD'),
      v_decisions_total,
      v_decisions_done,
      v_outcomes_count,
      v_outcomes_succ,
      to_char((v_lift_cents/100.0)::numeric, 'FM999G999G990D00'),
      v_pending_owner
    );

    BEGIN
      INSERT INTO public.owner_notifications (
        tenant_id, kind, severity, title, body, link, metadata, channel
      ) VALUES (
        v_tenant.id,
        'weekly_digest',
        'info',
        v_title,
        v_body,
        '/brand/decisions',
        jsonb_build_object(
          'week_start', v_week_start::text,
          'week_end',   v_week_end::text,
          'decisions_total', v_decisions_total,
          'decisions_done', v_decisions_done,
          'outcomes_count', v_outcomes_count,
          'outcomes_success', v_outcomes_succ,
          'lift_cents', v_lift_cents,
          'pending_owner', v_pending_owner,
          'top_actions', v_top_actions
        ),
        'in_app'
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'week_start', v_week_start,
    'week_end',   v_week_end,
    'at', now()
  );
END;
$function$;

-- Schedule: every Monday 09:00 UTC
SELECT cron.schedule(
  'owner-weekly-digest-monday',
  '0 9 * * 1',
  $cron$ SELECT public.generate_owner_weekly_digest(); $cron$
);
