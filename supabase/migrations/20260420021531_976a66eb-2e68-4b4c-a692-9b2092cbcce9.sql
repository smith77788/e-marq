-- Realtime for owner dashboard
ALTER TABLE public.outbound_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'outbound_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.outbound_messages';
  END IF;
END $$;

-- Hot-path indexes for autonomous engines
CREATE INDEX IF NOT EXISTS idx_customers_tenant_predicted
  ON public.customers (tenant_id, predicted_next_order_at)
  WHERE predicted_next_order_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_tenant_status_scheduled
  ON public.outbound_messages (tenant_id, status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_outbound_tenant_created
  ON public.outbound_messages (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_direction_created
  ON public.conversations (tenant_id, direction, created_at DESC);
