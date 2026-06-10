
SELECT cron.unschedule('marq-telegram-poll-2min');

SELECT cron.schedule(
  'marq-telegram-poll-1min',
  '* * * * *',
  $$
  select net.http_post(
    url:='https://e-marq.lovable.app/hooks/telegram/poll',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer <CRON_SECRET>"}'::jsonb,
    body:='{}'::jsonb,
    timeout_milliseconds := 35000
  )
  $$
);
