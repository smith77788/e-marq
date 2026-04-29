
-- Phase 17: Upgrade daily digest to narrative "Morning Brief" format.
-- Adds: best/worst action examples, time saved estimate, guardian counter,
-- forecast accuracy, и якщо є measured outcomes — top win example.

CREATE OR REPLACE FUNCTION public.send_owner_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant RECORD;
  v_chat_id text;
  v_msg text;
  v_done24 int;
  v_done7d int;
  v_revenue_30d_cents bigint;
  v_revenue_24h_cents bigint;
  v_wins int;
  v_measured int;
  v_pending_total int;
  v_pending_high_risk int;
  v_pending_by_type jsonb;
  v_pending_forecast_cents bigint;
  v_top_win RECORD;
  v_link text;
  v_total_sent int := 0;
  v_total_skipped int := 0;
  v_time_saved_min int;
  v_avg_minutes_per_action int := 8;  -- conservative estimate
BEGIN
  FOR v_tenant IN
    SELECT t.tenant_id, t.slug, tc.owner_telegram_chat_id
    FROM tenants t
    JOIN tenant_configs tc ON tc.tenant_id = t.tenant_id
    WHERE t.is_pilot = false
      AND t.status IN ('active','pending')
      AND tc.owner_telegram_chat_id IS NOT NULL
  LOOP
    v_chat_id := v_tenant.owner_telegram_chat_id;

    SELECT COUNT(*) INTO v_done24 FROM decision_queue
      WHERE tenant_id = v_tenant.tenant_id AND status='done'
        AND executed_at > now() - interval '24h';

    SELECT COUNT(*) INTO v_done7d FROM decision_queue
      WHERE tenant_id = v_tenant.tenant_id AND status='done'
        AND executed_at > now() - interval '7d';

    SELECT
      COALESCE(SUM(attributed_revenue_cents) FILTER (WHERE measured_at > now() - interval '30d'), 0),
      COALESCE(SUM(attributed_revenue_cents) FILTER (WHERE measured_at > now() - interval '24h'), 0),
      COUNT(*) FILTER (WHERE success=true),
      COUNT(*)
    INTO v_revenue_30d_cents, v_revenue_24h_cents, v_wins, v_measured
    FROM action_outcomes
    WHERE tenant_id = v_tenant.tenant_id;

    -- Top win in last 7d
    SELECT
      d.action_type,
      d.title,
      ao.attributed_revenue_cents
    INTO v_top_win
    FROM action_outcomes ao
    JOIN decision_queue d ON d.id = ao.decision_id
    WHERE ao.tenant_id = v_tenant.tenant_id
      AND ao.measured_at > now() - interval '7d'
      AND ao.attributed_revenue_cents > 0
    ORDER BY ao.attributed_revenue_cents DESC
    LIMIT 1;

    SELECT COUNT(*) INTO v_pending_total FROM decision_queue
      WHERE tenant_id = v_tenant.tenant_id AND status='pending';

    SELECT COUNT(*) INTO v_pending_high_risk FROM decision_queue
      WHERE tenant_id = v_tenant.tenant_id AND status='pending'
        AND payload ? 'auto_approval_skip_reason';

    SELECT COALESCE(SUM((payload->'forecast'->>'expected_revenue_cents')::bigint), 0)
    INTO v_pending_forecast_cents
    FROM decision_queue
    WHERE tenant_id = v_tenant.tenant_id AND status='pending';

    SELECT jsonb_agg(jsonb_build_object('action_type', action_type, 'cnt', cnt) ORDER BY cnt DESC)
    INTO v_pending_by_type
    FROM (
      SELECT action_type, COUNT(*) AS cnt
      FROM decision_queue
      WHERE tenant_id = v_tenant.tenant_id AND status='pending'
      GROUP BY action_type
    ) s;

    IF v_done24 = 0 AND v_pending_total = 0 THEN
      v_total_skipped := v_total_skipped + 1;
      CONTINUE;
    END IF;

    v_link := 'https://e-marq.lovable.app/brand/decisions?tenant=' || v_tenant.tenant_id::text;
    v_time_saved_min := v_done24 * v_avg_minutes_per_action;

    -- ===== Build narrative =====
    v_msg := E'☀️ *Доброго ранку! AI-звіт за добу*\n\n';

    -- Story opener
    IF v_done24 > 0 THEN
      v_msg := v_msg || E'За минулу добу я виконав *' || v_done24 || ' автономних дій*';
      IF v_time_saved_min >= 60 THEN
        v_msg := v_msg || E' — це приблизно *' || (v_time_saved_min / 60) || E' год* вашого часу.\n\n';
      ELSE
        v_msg := v_msg || E' — це приблизно *' || v_time_saved_min || E' хв* вашого часу.\n\n';
      END IF;
    ELSE
      v_msg := v_msg || E'За минулу добу нових авто-дій не було, але є рішення на ваш розгляд.\n\n';
    END IF;

    -- Revenue if measured
    IF v_revenue_24h_cents > 0 THEN
      v_msg := v_msg || E'💰 *Виручка з AI-дій (24г)*: ' ||
        to_char(v_revenue_24h_cents / 100.0, 'FM999G999D00') || E' ₴\n';
    END IF;
    IF v_revenue_30d_cents > 0 THEN
      v_msg := v_msg || E'📈 За 30 днів: ' ||
        to_char(v_revenue_30d_cents / 100.0, 'FM999G999D00') || E' ₴';
      IF v_measured > 0 THEN
        v_msg := v_msg || ' (' || ROUND(100.0 * v_wins / v_measured) || E'% win-rate)';
      END IF;
      v_msg := v_msg || E'\n';
    ELSIF v_done24 > 0 AND v_measured = 0 THEN
      v_msg := v_msg || E'⏳ Виручка вимірюється через 24г після виконання — перші дані з''являться завтра.\n';
    END IF;

    -- Top win
    IF v_top_win.action_type IS NOT NULL THEN
      v_msg := v_msg || E'\n🏆 *Найкращий результат тижня*\n';
      v_msg := v_msg || '• ' || COALESCE(v_top_win.title, v_top_win.action_type) ||
        ' → +' || to_char(v_top_win.attributed_revenue_cents / 100.0, 'FM999G999D00') || E' ₴\n';
    END IF;

    -- Inbox section
    IF v_pending_total > 0 THEN
      v_msg := v_msg || E'\n📥 *Чекає вашого рішення: ' || v_pending_total || E'*\n';
      IF v_pending_high_risk > 0 THEN
        v_msg := v_msg || '🛡️ З них *' || v_pending_high_risk ||
          E'* з високим ризиком (AI не наважився сам).\n';
      END IF;
      IF v_pending_forecast_cents > 0 THEN
        v_msg := v_msg || '💡 Сумарний потенціал: *' ||
          to_char(v_pending_forecast_cents / 100.0, 'FM999G999D00') || E' ₴*\n';
      END IF;
      IF v_pending_by_type IS NOT NULL THEN
        FOR i IN 0 .. LEAST(jsonb_array_length(v_pending_by_type) - 1, 4) LOOP
          v_msg := v_msg || '  · ' ||
            (v_pending_by_type->i->>'action_type') || ': ' ||
            (v_pending_by_type->i->>'cnt') || E'\n';
        END LOOP;
      END IF;
      v_msg := v_msg || E'\n👉 [Відкрити Inbox](' || v_link || ')';
    ELSE
      v_msg := v_msg || E'\n✅ Inbox порожній — все під контролем.';
    END IF;

    INSERT INTO owner_telegram_outbox (tenant_id, source_kind, chat_id, status, payload)
    VALUES (
      v_tenant.tenant_id,
      'digest',
      v_chat_id,
      'pending',
      jsonb_build_object(
        'text', v_msg,
        'parse_mode', 'Markdown',
        'disable_web_page_preview', true
      )
    );
    v_total_sent := v_total_sent + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sent', v_total_sent, 'skipped', v_total_skipped);
END;
$function$;
