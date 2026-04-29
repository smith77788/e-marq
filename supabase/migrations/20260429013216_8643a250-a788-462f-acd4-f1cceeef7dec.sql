-- Унікальність нотифікації по metadata->>'decision_id'
-- Робимо через partial unique index по metadata
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_notifications_unique_decision
  ON public.owner_notifications (tenant_id, kind, (metadata->>'decision_id'))
  WHERE kind = 'decision_pending' AND metadata ? 'decision_id';

CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_pending_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link text;
BEGIN
  -- Тільки нові pending з вимогою схвалення
  IF NEW.status <> 'pending' OR NEW.requires_approval IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- На UPDATE — пропускаємо, якщо decision вже був pending
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND OLD.requires_approval = true THEN
    RETURN NEW;
  END IF;

  v_link := '/brand/acos-loop?tenant=' || NEW.tenant_id::text;

  INSERT INTO public.owner_notifications (
    tenant_id, kind, severity, title, body, link, metadata, channel
  ) VALUES (
    NEW.tenant_id,
    'decision_pending',
    'high',
    'Нова дія потребує схвалення: ' || NEW.title,
    COALESCE(NEW.rationale, '')
      || E'\n\n'
      || 'Тип: ' || NEW.action_type
      || ' · впевненість ' || ROUND((NEW.confidence * 100)::numeric, 0)::text || '%',
    v_link,
    jsonb_build_object(
      'decision_id', NEW.id,
      'action_type', NEW.action_type,
      'agent_id', NEW.agent_id,
      'confidence', NEW.confidence,
      'expected_impact', NEW.expected_impact
    ),
    'in_app'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_owner_on_pending_decision ON public.decision_queue;
CREATE TRIGGER trg_notify_owner_on_pending_decision
  AFTER INSERT OR UPDATE OF status, requires_approval ON public.decision_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_notify_owner_on_pending_decision();

-- Backfill: створити нотифікації для існуючих pending decisions
INSERT INTO public.owner_notifications (
  tenant_id, kind, severity, title, body, link, metadata, channel
)
SELECT
  dq.tenant_id,
  'decision_pending',
  'high',
  'Нова дія потребує схвалення: ' || dq.title,
  COALESCE(dq.rationale, '')
    || E'\n\n'
    || 'Тип: ' || dq.action_type
    || ' · впевненість ' || ROUND((dq.confidence * 100)::numeric, 0)::text || '%',
  '/brand/acos-loop?tenant=' || dq.tenant_id::text,
  jsonb_build_object(
    'decision_id', dq.id,
    'action_type', dq.action_type,
    'agent_id', dq.agent_id,
    'confidence', dq.confidence,
    'expected_impact', dq.expected_impact
  ),
  'in_app'
FROM public.decision_queue dq
WHERE dq.status = 'pending'
  AND dq.requires_approval = true
ON CONFLICT DO NOTHING;