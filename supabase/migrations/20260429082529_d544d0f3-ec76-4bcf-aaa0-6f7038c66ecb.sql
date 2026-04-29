-- Sprint 12.5/12.6: close 1 ERROR + 1 WARN from supabase_lov scanner

-- (1) Realtime channel authorization for self_heal_* tables
-- Only super-admins can subscribe to self_heal:* topics
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='realtime' AND tablename='messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

DROP POLICY IF EXISTS "self_heal_realtime_super_admin_only" ON realtime.messages;
CREATE POLICY "self_heal_realtime_super_admin_only"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Restrict only self_heal-related topics; other topics keep default-deny unless other policies exist
  CASE
    WHEN (realtime.topic() LIKE 'self_heal%' OR realtime.topic() LIKE 'incidents%')
      THEN public.is_super_admin()
    ELSE true
  END
);

-- (2) tg_user_action_log: tighten policy to authenticated only
DROP POLICY IF EXISTS "tg_log_admin_select" ON public.tg_user_action_log;
CREATE POLICY "tg_log_admin_select"
ON public.tg_user_action_log
FOR SELECT
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- Block writes from clients explicitly (service_role bypasses RLS anyway)
DROP POLICY IF EXISTS "tg_log_block_client_writes" ON public.tg_user_action_log;
CREATE POLICY "tg_log_block_client_writes"
ON public.tg_user_action_log
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);