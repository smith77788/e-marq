
SELECT cron.unschedule('marq-telegram-poll-2min');

SELECT cron.schedule(
  'marq-telegram-poll-1min',
  '* * * * *',
  $$
  select net.http_post(
    url:='https://e-marq.lovable.app/hooks/telegram/poll',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer mwmiGnvR5F4PIhHzFPg3wNd67fERqhBX9BtK68ErdEHVTMM8ssYqX_rII5c3hneY"}'::jsonb,
    body:='{}'::jsonb,
    timeout_milliseconds := 35000
  )
  $$
);
