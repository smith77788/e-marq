CREATE TABLE IF NOT EXISTS public.telegram_processed_updates (
  update_id BIGINT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_processed_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "telegram_processed_updates_super_only"
  ON public.telegram_processed_updates
  FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE INDEX IF NOT EXISTS idx_telegram_processed_updates_processed_at
  ON public.telegram_processed_updates (processed_at DESC);

-- Cleanup function: keep last 7 days only
CREATE OR REPLACE FUNCTION public.cleanup_telegram_processed_updates()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.telegram_processed_updates
  WHERE processed_at < now() - INTERVAL '7 days';
$$;