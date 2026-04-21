-- 1) Owner chat binding column
ALTER TABLE public.tenant_configs
  ADD COLUMN IF NOT EXISTS owner_telegram_chat_id text;

-- 2) Outbox to dedupe + remember message_id for in-place updates
CREATE TABLE IF NOT EXISTS public.owner_telegram_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('insight','action','notification')),
  source_id uuid NOT NULL,
  chat_id text,
  tg_message_id bigint,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (tenant_id, source_kind, source_id)
);

ALTER TABLE public.owner_telegram_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outbox_admin_select" ON public.owner_telegram_outbox;
CREATE POLICY "outbox_admin_select" ON public.owner_telegram_outbox
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_owner_outbox_status ON public.owner_telegram_outbox(status, created_at);

-- 3) Generic trigger function: enqueue + fire HTTP push
CREATE OR REPLACE FUNCTION public.notify_owner_telegram(_tenant_id uuid, _kind text, _source_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _chat text;
  _app_url text := 'https://e-marq.lovable.app';
  _anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw';
BEGIN
  SELECT owner_telegram_chat_id INTO _chat FROM public.tenant_configs WHERE tenant_id = _tenant_id;
  IF _chat IS NULL OR _chat = '' THEN RETURN; END IF;

  -- enqueue (idempotent)
  INSERT INTO public.owner_telegram_outbox (tenant_id, source_kind, source_id, chat_id)
  VALUES (_tenant_id, _kind, _source_id, _chat)
  ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING;

  -- best-effort HTTP fire (cron will retry pending rows otherwise)
  BEGIN
    PERFORM net.http_post(
      url := _app_url || '/hooks/telegram/notify-owner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _anon_key
      ),
      body := jsonb_build_object('tenant_id', _tenant_id, 'kind', _kind, 'source_id', _source_id)
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;
END;
$$;

-- 4) Trigger on ai_insights INSERT
CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_insight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_owner_telegram(NEW.tenant_id, 'insight', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_owner_insight ON public.ai_insights;
CREATE TRIGGER trg_notify_owner_insight
  AFTER INSERT ON public.ai_insights
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_notify_owner_on_insight();

-- 5) Trigger on ai_actions INSERT (only for pending)
CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM public.notify_owner_telegram(NEW.tenant_id, 'action', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_owner_action ON public.ai_actions;
CREATE TRIGGER trg_notify_owner_action
  AFTER INSERT ON public.ai_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_notify_owner_on_action();

-- 6) Trigger on owner_notifications (only severity high/critical)
CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.severity IN ('high','critical') THEN
    PERFORM public.notify_owner_telegram(NEW.tenant_id, 'notification', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_owner_notification ON public.owner_notifications;
CREATE TRIGGER trg_notify_owner_notification
  AFTER INSERT ON public.owner_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_notify_owner_on_notification();

-- 7) RPC for owner to set/clear their chat id
CREATE OR REPLACE FUNCTION public.set_owner_telegram_chat(_tenant_id uuid, _chat_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenant_configs
     SET owner_telegram_chat_id = NULLIF(trim(_chat_id), '')
   WHERE tenant_id = _tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_owner_telegram_chat(uuid, text) TO authenticated;