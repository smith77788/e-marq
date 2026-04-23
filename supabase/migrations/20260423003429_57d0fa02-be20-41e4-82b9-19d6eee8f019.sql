-- Sprint 22: Reanimation phase 2 — fix cron infrastructure
-- 1) Remove duplicate telegram-poll job (was conflicting with marq-telegram-poll-2min → 409 Conflict)
SELECT cron.unschedule('telegram-poll-every-minute');

-- 2) Replace 5 broken preview URLs with stable production URL (e-marq.lovable.app)
SELECT cron.unschedule('acos-abandoned-cart-all');
SELECT cron.unschedule('acos-feedback-loop-all-daily');
SELECT cron.unschedule('acos-reorder-all-daily');
SELECT cron.unschedule('acos-sales-bot-all-5min');
SELECT cron.unschedule('acos-winback-all');

SELECT cron.schedule(
  'acos-abandoned-cart-all',
  '*/15 * * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/engines/abandoned-cart-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

SELECT cron.schedule(
  'acos-feedback-loop-all-daily',
  '0 3 * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/feedback-loop-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

SELECT cron.schedule(
  'acos-reorder-all-daily',
  '0 9 * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/engines/reorder-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

SELECT cron.schedule(
  'acos-sales-bot-all-5min',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/sales-bot-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

SELECT cron.schedule(
  'acos-winback-all',
  '0 10 * * 1',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/engines/winback-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFow_FUC2OkH0-IBZRwEDdg"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- 3) Replace heavy `cron-all` (timeouts) with chunked schedule:
--    catalog @ 06:00, marketing @ 07:00, ops @ 08:00, retention @ 09:00, lead-gen every 30min
SELECT cron.unschedule('agents-analyze-hourly');

SELECT cron.schedule(
  'agents-chunk-catalog-daily',
  '0 6 * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/cron-chunk',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{"chunk":"catalog"}'::jsonb
  );$$
);

SELECT cron.schedule(
  'agents-chunk-marketing-daily',
  '0 7 * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/cron-chunk',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{"chunk":"marketing"}'::jsonb
  );$$
);

SELECT cron.schedule(
  'agents-chunk-ops-daily',
  '0 8 * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/cron-chunk',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{"chunk":"ops"}'::jsonb
  );$$
);

SELECT cron.schedule(
  'agents-chunk-retention-daily',
  '0 9 * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/cron-chunk',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{"chunk":"retention"}'::jsonb
  );$$
);

SELECT cron.schedule(
  'agents-chunk-lead-gen-30min',
  '*/30 * * * *',
  $$SELECT net.http_post(
    url := 'https://e-marq.lovable.app/hooks/agents/cron-chunk',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnemN1a2huYXJ3ZXp4d2R5b25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjY5MjcsImV4cCI6MjA5MjIwMjkyN30.6JSHX3blYqoapNhO7WZL6LgDyGcDYSanR2Ob7nayEuw"}'::jsonb,
    body := '{"chunk":"lead-gen"}'::jsonb
  );$$
);

-- 4) Lower telegram intent score threshold for active tenant (basic-food)
UPDATE outreach_settings
SET value = '0.10'::jsonb,
    updated_at = NOW()
WHERE tenant_id = 'abec86dc-dfa9-4cde-adc3-c813b7ec455f'
  AND key = 'telegram_min_intent_score';