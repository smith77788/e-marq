-- Drop legacy
SELECT cron.unschedule('propose-decisions-every-15min');
DROP FUNCTION IF EXISTS public.propose_decisions_all_tenants() CASCADE;
DROP FUNCTION IF EXISTS public.propose_decisions_from_insights(uuid) CASCADE;

-- Replace auto_approve with bootstrap-aware logic
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
  v_bootstrap_used int;
  v_bootstrap_cap int := 3;
  v_mode text;
BEGIN
  FOR d IN
    SELECT dq.id, dq.tenant_id, dq.action_type, dq.created_at, dq.payload
      FROM public.decision_queue dq
      JOIN public.auto_approval_policy p
        ON p.action_type = dq.action_type AND p.enabled = true
     WHERE dq.status = 'pending'
       AND dq.created_at > now() - (p.max_age_hours || ' hours')::interval
       AND COALESCE((dq.payload->>'requires_owner')::bool, false) = false
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
      -- Bootstrap window: allow up to N auto-approvals per (tenant, action_type)
      -- before first measurements arrive.
      SELECT count(*) INTO v_bootstrap_used
        FROM public.decision_queue
       WHERE tenant_id = d.tenant_id
         AND action_type = d.action_type
         AND approved_by_auto = true
         AND payload->>'approval_mode' = 'bootstrap';
      IF v_bootstrap_used < v_bootstrap_cap THEN
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
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_approved, v_breakdown;
END;
$function$;

-- Backfill: tag existing auto-approved decisions with mode='bootstrap' so cap counts them
UPDATE public.decision_queue
SET payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('approval_mode','bootstrap')
WHERE approved_by_auto = true
  AND payload->>'approval_mode' IS NULL
  AND created_at > now() - interval '7 days';