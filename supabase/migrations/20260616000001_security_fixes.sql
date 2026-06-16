-- ============================================================
-- Security fixes for 3 critical findings from Lovable scanner
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Fix 1: topup_requests UPDATE policy
--
-- The old policy allowed ANY tenant member to UPDATE any row
-- in their tenant, including status / processed_by / handled_by.
-- A regular member could self-approve their own topup request.
--
-- Fix: only super_admin can update (approve/reject/process).
-- Members may INSERT (already covered by the insert policy).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "topup_requests update by member" ON public.topup_requests;

CREATE POLICY "topup_requests update by super_admin"
  ON public.topup_requests
  FOR UPDATE
  TO authenticated
  USING  (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ─────────────────────────────────────────────────────────────
-- Fix 2: Realtime orders broadcast — tenant isolation
--
-- The existing self_heal_realtime_super_admin_only policy had
-- ELSE true, meaning every authenticated user could subscribe
-- to any Broadcast/Presence topic, including orders:* topics
-- that carry customer PII (email, name, address, payment_ref).
--
-- Fix: add an explicit orders:* branch that restricts to
-- members of the tenant whose ID is encoded in the topic suffix.
-- All other topics keep the previous behavior (true = allowed
-- for authenticated users — covers pulse-*, nc-realtime, etc.).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "self_heal_realtime_super_admin_only" ON realtime.messages;

CREATE POLICY "realtime_messages_tenant_scope"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN realtime.topic() LIKE 'self_heal%'
        OR realtime.topic() LIKE 'incidents%'
        THEN public.is_super_admin()
      WHEN realtime.topic() LIKE 'orders:%'
        THEN public.is_tenant_member(
          split_part(realtime.topic(), ':', 2)::uuid
        )
      ELSE true  -- pulse-*, nc-realtime, revenue-feed-*, etc.
    END
  );
