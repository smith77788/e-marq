UPDATE public.self_heal_incidents
SET status='dismissed', resolved_at=now()
WHERE id='53c41701-5980-4239-a577-99f481defe63' AND status IN ('open','fixing');