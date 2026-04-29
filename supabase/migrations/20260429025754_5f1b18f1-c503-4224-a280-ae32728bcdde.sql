CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_pending_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_link text;
BEGIN
  IF NEW.status <> 'pending' OR NEW.requires_approval IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND OLD.requires_approval = true THEN
    RETURN NEW;
  END IF;

  v_link := '/brand/decisions?tenant=' || NEW.tenant_id::text;

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
END $function$;