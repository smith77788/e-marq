-- Disable polling cron (route file remains for emergency fallback)
DO $$ BEGIN
  PERFORM cron.unschedule('marq-telegram-poll-1min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Daily cleanup of processed update_ids
DO $$ BEGIN
  PERFORM cron.unschedule('marq-telegram-cleanup-processed');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'marq-telegram-cleanup-processed',
  '17 3 * * *',
  $$ SELECT public.cleanup_telegram_processed_updates(); $$
);