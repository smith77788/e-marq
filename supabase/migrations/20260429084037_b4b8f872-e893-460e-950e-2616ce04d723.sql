
CREATE OR REPLACE FUNCTION public.send_owner_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant RECORD;
  v_chat_id text;
  v_msg text;
  v_done24 int;
  v_done7d int;
  v_revenue_30d_cents bigint;
  v_wins int;
  v_measured int;
  v_pending_total int;
  v_pending_by_type jsonb;
  v_link text;
  v_total_sent int := 0;
  v_total_skipped int := 0;
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
      COUNT(*) FILTER (WHERE success=true),
      COUNT(*)
    INTO v_revenue_30d_cents, v_wins, v_measured
    FROM action_outcomes
    WHERE tenant_id = v_tenant.tenant_id;

    SELECT COUNT(*) INTO v_pending_total FROM decision_queue
      WHERE tenant_id = v_tenant.tenant_id AND status='pending';

    SELECT jsonb_agg(jsonb_build_object('action_type', action_type, 'cnt', cnt) ORDER BY cnt DESC)
    INTO v_pending_by_type
    FROM (
      SELECT action_type, COUNT(*) AS cnt
      FROM decision_queue
      WHERE tenant_id = v_tenant.tenant_id AND status='pending'
      GROUP BY action_type
    ) s;

    -- Skip якщо нічого не відбулось і немає pending
    IF v_done24 = 0 AND v_pending_total = 0 THEN
      v_total_skipped := v_total_skipped + 1;
      CONTINUE;
    END IF;

    v_link := 'https://e-marq.lovable.app/brand/decisions?tenant=' || v_tenant.tenant_id::text;

    v_msg := E'🤖 *AI Daily Digest*\n\n';
    v_msg := v_msg || E'📊 *За 24 години*\n';
    v_msg := v_msg || '• Виконано дій: *' || v_done24 || E'*\n';
    v_msg := v_msg || '• За тиждень: ' || v_done7d || E'\n';

    IF v_measured > 0 THEN
      v_msg := v_msg || '• Виручка (30д): *' ||
        to_char(v_revenue_30d_cents / 100.0, 'FM999G999D00') || E' ₴*\n';
      v_msg := v_msg || '• Win-rate: ' ||
        ROUND(100.0 * v_wins / v_measured) || '% (' || v_wins || '/' || v_measured || E')\n';
    ELSE
      v_msg := v_msg || E'• Виручка: чекаємо вимірювання (24год gate)\n';
    END IF;

    IF v_pending_total > 0 THEN
      v_msg := v_msg || E'\n📥 *Inbox: ' || v_pending_total || E' pending*\n';
      IF v_pending_by_type IS NOT NULL THEN
        FOR i IN 0 .. LEAST(jsonb_array_length(v_pending_by_type) - 1, 5) LOOP
          v_msg := v_msg || '• ' ||
            (v_pending_by_type->i->>'action_type') || ': ' ||
            (v_pending_by_type->i->>'cnt') || E'\n';
        END LOOP;
      END IF;
      v_msg := v_msg || E'\n👉 [Переглянути Inbox](' || v_link || ')';
    ELSE
      v_msg := v_msg || E'\n✅ Inbox порожній — усе під контролем.';
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
$$;
