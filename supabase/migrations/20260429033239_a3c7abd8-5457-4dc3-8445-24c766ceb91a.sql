DROP FUNCTION IF EXISTS public.auto_approve_eligible_decisions();

CREATE OR REPLACE FUNCTION public.auto_approve_eligible_decisions()
RETURNS TABLE(approved_count int, by_action jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.action_type, dq.created_at, dq.payload
      FROM public.decision_queue dq
      JOIN public.auto_approval_policy p
        ON p.action_type = dq.action_type AND p.enabled = true
     WHERE dq.status = 'pending'
       AND dq.created_at > now() - (p.max_age_hours || ' hours')::interval
       AND COALESCE((dq.payload->>'requires_owner')::bool, false) = false
     ORDER BY dq.created_at ASC
  LOOP
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
      END IF;
    END IF;

    IF v_mode IS NOT NULL THEN
      UPDATE public.decision_queue
         SET status = 'approved',
             updated_at = now(),
             approved_at = now(),
             approved_by_auto = true,
             payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('approval_mode', v_mode)
       WHERE id = d.id AND status = 'pending';

      IF FOUND THEN
        v_approved := v_approved + 1;
        v_breakdown := jsonb_set(
          v_breakdown,
          ARRAY[d.action_type],
          to_jsonb(COALESCE((v_breakdown->>d.action_type)::int, 0) + 1)
        );
        IF v_mode = 'bootstrap' THEN
          v_key := d.tenant_id::text || '/' || d.action_type;
          v_counters := jsonb_set(
            v_counters, ARRAY[v_key],
            to_jsonb(((v_counters->>v_key)::int) + 1)
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  approved_count := v_approved;
  by_action := v_breakdown;
  RETURN NEXT;
END;
$$;