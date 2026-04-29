DELETE FROM public.self_heal_actions
WHERE kind = 'flag_stuck_order'
  AND status = 'skipped'
  AND decision = 'block'
  AND created_at > now() - interval '14 days';

UPDATE public.self_heal_incidents
SET status = 'dismissed',
    resolved_at = now(),
    root_cause = root_cause || ' [auto-dismissed: pilot tenant synthetic orders]'
WHERE detector = 'orders_stuck'
  AND tenant_id IN (SELECT id FROM public.tenants WHERE is_pilot = true)
  AND status IN ('open', 'fixing', 'monitoring');