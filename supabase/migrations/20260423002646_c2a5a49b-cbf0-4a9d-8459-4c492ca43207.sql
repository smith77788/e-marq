-- Sprint 21: Реанімація — pg_cron для всіх ключових агентів
-- Усі викликаються через POST на /hooks/* з anon-токеном (handler перевіряє)

-- 1. Очистимо існуючі задачі з тими ж іменами (якщо були)
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN (
    'marq-agents-run-all-15min',
    'marq-engines-dispatch-5min',
    'marq-sales-bot-30min',
    'marq-feedback-loop-hourly',
    'marq-outreach-reddit-3h',
    'marq-outreach-google-6h',
    'marq-outreach-telegram-3h',
    'marq-outreach-instagram-12h',
    'marq-outreach-composer-30min',
    'marq-outreach-action-executor-15min',
    'marq-outreach-quality-scorer-hourly',
    'marq-outreach-roi-collector-daily',
    'marq-tg-user-action-executor-10min',
    'marq-dntrade-cron-15min',
    'marq-dntrade-health-cron-hourly',
    'marq-engines-abandoned-cart-hourly',
    'marq-engines-reorder-daily',
    'marq-engines-winback-daily',
    'marq-telegram-poll-2min',
    'marq-telegram-notify-owner-5min'
  );
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 2. Активний crontab (anon-key для авторизації)
-- Базовий URL: https://e-marq.lovable.app
-- Anon key: eyJhbGciOiJIUzI1NiIs... (той самий, що в supabase/client.ts)

-- Helper macro: SQL не має макросів, тому повторюємо

SELECT cron.schedule('marq-agents-run-all-15min','*/15 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/run-all',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{"source":"cron"}'::jsonb) $$);

SELECT cron.schedule('marq-engines-dispatch-5min','*/5 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/engines/dispatch',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-sales-bot-30min','*/30 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/sales-bot-all',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-feedback-loop-hourly','7 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/feedback-loop-all',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

-- Outreach hunters (різні інтервали щоб не вдарити в один момент)
SELECT cron.schedule('marq-outreach-reddit-3h','12 */3 * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/outreach-reddit-hunter',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-outreach-google-6h','22 */6 * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/outreach-google-hunter',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-outreach-telegram-3h','37 */3 * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/outreach-telegram-hunter',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-outreach-instagram-12h','42 */12 * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/outreach-instagram-hunter',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

-- Outreach pipeline downstream
SELECT cron.schedule('marq-outreach-composer-30min','*/30 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/outreach-composer',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-outreach-action-executor-15min','*/15 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/outreach-action-executor',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-outreach-quality-scorer-hourly','17 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/outreach-quality-scorer',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-outreach-roi-collector-daily','27 4 * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/outreach-roi-collector',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

-- MTProto (працюватиме коли підключиться bridge — поки тихо скіпається)
SELECT cron.schedule('marq-tg-user-action-executor-10min','*/10 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/agents/tg-user-action-executor',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

-- DNTrade
SELECT cron.schedule('marq-dntrade-cron-15min','*/15 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/integrations/dntrade-cron',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-dntrade-health-cron-hourly','3 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/integrations/dntrade-health-cron',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

-- Engines (cart/reorder/winback)
SELECT cron.schedule('marq-engines-abandoned-cart-hourly','13 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/engines/abandoned-cart-all',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-engines-reorder-daily','33 5 * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/engines/reorder-all',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-engines-winback-daily','47 6 * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/engines/winback-all',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

-- Telegram bot polling та outbox
SELECT cron.schedule('marq-telegram-poll-2min','*/2 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/telegram/poll',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);

SELECT cron.schedule('marq-telegram-notify-owner-5min','*/5 * * * *',
  $$ select net.http_post(url:='https://e-marq.lovable.app/hooks/telegram/notify-owner',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
     body:='{}'::jsonb) $$);