CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_pilot boolean;
BEGIN
  IF NEW.severity NOT IN ('high','critical') THEN
    RETURN NEW;
  END IF;
  SELECT is_pilot INTO _is_pilot FROM public.tenants WHERE id = NEW.tenant_id;
  IF _is_pilot IS TRUE THEN
    RETURN NEW;
  END IF;
  PERFORM public.notify_owner_telegram(NEW.tenant_id, 'notification', NEW.id);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_notify_owner_on_notification() IS
'Owner notification → Telegram push. Skips pilot tenants (is_pilot=true) to avoid synthetic-data spam.';