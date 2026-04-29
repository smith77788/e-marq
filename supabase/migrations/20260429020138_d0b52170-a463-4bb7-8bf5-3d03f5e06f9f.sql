
-- Whitelist of action types safe for autonomous approval
CREATE TABLE IF NOT EXISTS public.auto_approval_policy (
  action_type text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  min_success_history int NOT NULL DEFAULT 1,
  max_age_hours int NOT NULL DEFAULT 24,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auto_approval_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auto_approval_policy_super_admin" ON public.auto_approval_policy;
CREATE POLICY "auto_approval_policy_super_admin" ON public.auto_approval_policy
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Seed safe defaults
INSERT INTO public.auto_approval_policy(action_type, enabled, min_success_history, notes) VALUES
  ('repeat_purchase_nudge', true,  1, 'Low-risk customer touch'),
  ('cross_sell_recommend',  true,  1, 'Low-risk recommendation'),
  ('request_review',        true,  1, 'No financial impact'),
  ('request_ugc',           true,  1, 'No financial impact'),
  ('winback_outreach',      true,  1, 'Soft outreach with discount cap'),
  ('feature_product',       true,  1, 'Storefront highlighting'),
  ('discount_dead_stock',   true,  2, 'Pricing change — needs 2 prior successes'),
  ('price_adjust',          true,  2, 'Pricing change — needs 2 prior successes'),
  -- Explicitly KEEP manual:
  ('owner_setup_task',      false, 0, 'Requires owner action by design'),
  ('owner_review',          false, 0, 'Human review required'),
  ('flag_for_review',       false, 0, 'Human review required')
ON CONFLICT (action_type) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      min_success_history = EXCLUDED.min_success_history,
      notes = EXCLUDED.notes,
      updated_at = now();

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
    -- Check tenant-specific success history for this action_type
    SELECT COUNT(*) INTO v_history_succ
      FROM public.action_outcomes ao
     WHERE ao.tenant_id = d.tenant_id
       AND ao.action_type = d.action_type
       AND ao.success = true;

    IF v_history_succ >= (
      SELECT min_success_history FROM public.auto_approval_policy
       WHERE action_type = d.action_type
    ) THEN
      UPDATE public.decision_queue
         SET status = 'approved',
             updated_at = now(),
             approved_at = now(),
             approved_by_auto = true
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
$$;

-- Add tracking columns if missing
ALTER TABLE public.decision_queue
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_auto boolean NOT NULL DEFAULT false;

-- Schedule
DO $$
DECLARE jid int;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'auto-approve-decisions-15min';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  PERFORM cron.schedule('auto-approve-decisions-15min', '*/15 * * * *',
    $cmd$SELECT public.auto_approve_eligible_decisions();$cmd$);
END $$;

-- Run now
SELECT public.auto_approve_eligible_decisions();
