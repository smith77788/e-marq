
DROP POLICY IF EXISTS "events_insert_validated" ON public.events;
CREATE POLICY "events_insert_active_tenant"
  ON public.events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = events.tenant_id AND t.status = 'active'
    )
  );

DROP POLICY IF EXISTS "search_queries_insert_validated" ON public.search_queries;
CREATE POLICY "search_queries_insert_active_tenant"
  ON public.search_queries
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = search_queries.tenant_id AND t.status = 'active'
    )
  );
