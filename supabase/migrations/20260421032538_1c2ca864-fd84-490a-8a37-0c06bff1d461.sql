-- Repoint pg_cron jobs to the current published app origin so Telegram polling
-- and agent ticks actually reach a live endpoint (the old domain returned 404).
SELECT cron.unschedule('telegram-poll-every-minute');
SELECT cron.unschedule('agents-tick-every-minute');
SELECT cron.unschedule('agents-analyze-hourly');

SELECT cron.schedule(
  'telegram-poll-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/telegram/poll',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'agents-tick-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/tick',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'agents-analyze-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/cron-all',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Also fix the trigger_onboarding_agent function which has the same stale URL.
CREATE OR REPLACE FUNCTION public.trigger_onboarding_agent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _app_url text := 'https://e-marq.lovable.app';
  _anon_key text := '<SUPABASE_PUBLISHABLE_KEY>';
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := _app_url || '/hooks/agents/onboarding',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _anon_key
      ),
      body := jsonb_build_object('tenant_id', NEW.id)
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;