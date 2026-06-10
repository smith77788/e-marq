-- Schedule abandoned cart engine every 15 minutes
SELECT cron.schedule(
  'acos-abandoned-cart-all',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://id-preview--fe3353ab-9ea3-4fcd-945e-8a76c46212c9.lovable.app/hooks/engines/abandoned-cart-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>","Lovable-Context":"cron"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Schedule winback engine weekly (Mondays 10:00 UTC)
SELECT cron.schedule(
  'acos-winback-all',
  '0 10 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://id-preview--fe3353ab-9ea3-4fcd-945e-8a76c46212c9.lovable.app/hooks/engines/winback-all',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_PUBLISHABLE_KEY>","Lovable-Context":"cron"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
