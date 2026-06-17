-- ============================================================================
-- Fix conversations INSERT RLS: prevent cross-tenant data injection
-- ============================================================================
-- The previous policy allowed any anonymous/authenticated user to insert
-- conversations with ANY tenant_id. This restricts inserts to:
-- 1. Tenant members (for their own tenant)
-- 2. Service role (for system-generated conversations)
-- ============================================================================

-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS conversations_insert_public ON public.conversations;

-- New policy: only tenant members can insert conversations for their tenant
CREATE POLICY conversations_insert_tenant_member
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

-- Service role can insert anything (for system-generated conversations)
CREATE POLICY conversations_insert_service_role
  ON public.conversations FOR INSERT TO service_role
  WITH CHECK (true);
