
CREATE OR REPLACE FUNCTION public.generate_owner_weekly_recap()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r record;
  v_week_start date := date_trunc('week', now())::date - 7;
  v_body text;
  v_total_decisions int;
  v_done int;
  v_auto int;
  v_attributed bigint;
  v_top text;
  v_skipped int;
BEGIN
  FOR r IN
    SELECT t.id AS tenant_id, t.name AS tenant_name
    FROM tenants t
    WHERE t.status IN ('active','pending')
      AND COALESCE(t.is_pilot, false) = false
  LOOP
    -- Skip if recap already sent for this week
    IF EXISTS (
      SELECT 1 FROM owner_notifications
      WHERE tenant_id = r.tenant_id
        AND kind = 'weekly_recap'
        AND (metadata->>'week_start') = v_week_start::text
    ) THEN
      CONTINUE;
    END IF;

    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE status = 'done'),
      COUNT(*) FILTER (WHERE approved_by_auto = true)
    INTO v_total_decisions, v_done, v_auto
    FROM decision_queue
    WHERE tenant_id = r.tenant_id
      AND created_at >= v_week_start
      AND created_at < v_week_start + 7;

    IF v_total_decisions = 0 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(attributed_revenue_cents), 0)
    INTO v_attributed
    FROM action_outcomes
    WHERE tenant_id = r.tenant_id
      AND measured_at >= v_week_start
      AND measured_at < v_week_start + 7
      AND success = true;

    SELECT string_agg(action_type || ' (' || cnt || ')', ', ' ORDER BY cnt DESC)
    INTO v_top
    FROM (
      SELECT action_type, COUNT(*) AS cnt
      FROM decision_queue
      WHERE tenant_id = r.tenant_id
        AND created_at >= v_week_start
        AND created_at < v_week_start + 7
        AND status IN ('done','approved')
      GROUP BY action_type
      ORDER BY cnt DESC
      LIMIT 3
    ) s;

    SELECT COUNT(*) INTO v_skipped
    FROM decision_queue
    WHERE tenant_id = r.tenant_id
      AND created_at >= v_week_start
      AND created_at < v_week_start + 7
      AND status = 'rejected';

    v_body := '🤖 Тиждень автономії (' || v_week_start::text || ' — ' || (v_week_start + 6)::text || E'):\n'
      || '• Рішень: ' || v_total_decisions || ' (виконано ' || v_done || ', авто-апрув ' || v_auto || ')' || E'\n'
      || '• Attributed revenue: ' || ROUND(v_attributed/100.0)::text || ' UAH' || E'\n'
      || '• Скіпнуто/відхилено: ' || v_skipped || E'\n'
      || COALESCE('• Топ дії: ' || v_top, '');

    INSERT INTO owner_notifications (tenant_id, kind, severity, title, body, link, metadata, channel)
    VALUES (
      r.tenant_id,
      'weekly_recap',
      'info',
      'Тижневий звіт автономії',
      v_body,
      '/brand/decisions',
      jsonb_build_object(
        'week_start', v_week_start,
        'decisions_total', v_total_decisions,
        'decisions_done', v_done,
        'auto_approved', v_auto,
        'attributed_revenue_cents', v_attributed,
        'rejected', v_skipped
      ),
      'telegram'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('owner-weekly-recap-mon-0930'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('owner-weekly-recap-mon-0930', '30 9 * * 1', $$ SELECT public.generate_owner_weekly_recap(); $$);
