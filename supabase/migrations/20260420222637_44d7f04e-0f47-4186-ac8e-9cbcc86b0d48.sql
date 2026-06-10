-- Trigger: коли створюється tenant — асинхронно дзвонимо onboarding-агента
-- щоб одразу зʼявилися перші insights (no_products, no_telegram, no_orders…).
CREATE OR REPLACE FUNCTION public.trigger_onboarding_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _app_url text := 'https://autonomy-growth-lab.lovable.app';
  _anon_key text := '<SUPABASE_PUBLISHABLE_KEY>';
BEGIN
  -- best-effort, не блокуємо створення tenant якщо агент впаде
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
    -- ignore: cron у будь-якому разі підбере через годину
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_tenant_created_run_onboarding ON public.tenants;
CREATE TRIGGER on_tenant_created_run_onboarding
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_onboarding_agent();