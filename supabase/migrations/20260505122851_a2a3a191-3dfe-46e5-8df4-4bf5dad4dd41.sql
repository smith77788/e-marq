-- 1. Insight trigger: skip pilot tenants
CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_insight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_pilot boolean;
BEGIN
  SELECT is_pilot INTO _is_pilot FROM public.tenants WHERE id = NEW.tenant_id;
  IF _is_pilot IS TRUE THEN
    RETURN NEW;
  END IF;
  PERFORM public.notify_owner_telegram(NEW.tenant_id, 'insight', NEW.id);
  RETURN NEW;
END;
$function$;

-- 2. Action trigger: skip pilot tenants
CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_pilot boolean;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  SELECT is_pilot INTO _is_pilot FROM public.tenants WHERE id = NEW.tenant_id;
  IF _is_pilot IS TRUE THEN
    RETURN NEW;
  END IF;
  PERFORM public.notify_owner_telegram(NEW.tenant_id, 'action', NEW.id);
  RETURN NEW;
END;
$function$;

-- 3. Pending decision trigger: skip pilot tenants
CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_pending_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_link text;
  _is_pilot boolean;
BEGIN
  IF NEW.status <> 'pending' OR NEW.requires_approval IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND OLD.requires_approval = true THEN
    RETURN NEW;
  END IF;

  SELECT is_pilot INTO _is_pilot FROM public.tenants WHERE id = NEW.tenant_id;
  IF _is_pilot IS TRUE THEN
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

-- 4. Drain pending pilot outbox (mark as skipped so cron не намагається слати)
UPDATE public.owner_telegram_outbox o
SET status = 'skipped',
    error = 'pilot_tenant_silenced'
WHERE status IN ('pending','queued')
  AND tenant_id IN (SELECT id FROM public.tenants WHERE is_pilot = true);
