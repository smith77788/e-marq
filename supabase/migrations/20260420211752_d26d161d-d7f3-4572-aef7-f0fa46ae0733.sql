
-- Telegram bot polling state (singleton)
CREATE TABLE IF NOT EXISTS public.telegram_bot_state (
  id int PRIMARY KEY CHECK (id = 1),
  update_offset bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_bot_state (id, update_offset)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "telegram_bot_state_super_only" ON public.telegram_bot_state
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Routing: which chat is bound to which tenant (set by /start <slug>)
CREATE TABLE IF NOT EXISTS public.telegram_chat_routing (
  chat_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_chat_routing_tenant ON public.telegram_chat_routing(tenant_id);

ALTER TABLE public.telegram_chat_routing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tg_routing_select_member_or_super" ON public.telegram_chat_routing
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Cron: every minute call /hooks/telegram/poll  (long-poll loop ~55s)
SELECT cron.unschedule('telegram-poll-every-minute') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='telegram-poll-every-minute');

SELECT cron.schedule(
  'telegram-poll-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://autonomy-growth-lab.lovable.app/hooks/telegram/poll',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Cron: every minute dispatch outbound queue + sales-bot replies for ALL tenants
SELECT cron.unschedule('agents-tick-every-minute') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='agents-tick-every-minute');

SELECT cron.schedule(
  'agents-tick-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://autonomy-growth-lab.lovable.app/hooks/agents/tick',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Cron: every hour run all analysis agents
SELECT cron.unschedule('agents-analyze-hourly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='agents-analyze-hourly');

SELECT cron.schedule(
  'agents-analyze-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://autonomy-growth-lab.lovable.app/hooks/agents/cron-all',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
