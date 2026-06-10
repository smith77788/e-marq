CREATE OR REPLACE FUNCTION public.trigger_onboarding_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _app_url text := 'https://e-marq.lovable.app';
  _cron_secret text := '<CRON_SECRET>';
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := _app_url || '/hooks/agents/onboarding',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _cron_secret
      ),
      body := jsonb_build_object('tenant_id', NEW.id)
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;