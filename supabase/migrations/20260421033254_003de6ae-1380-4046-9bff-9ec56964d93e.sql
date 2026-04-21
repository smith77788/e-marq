-- Allow tenant members to create owner_notifications for their own tenant
-- (needed for "Send test ping" button and other in-app notification creators).
CREATE POLICY "notif_insert"
ON public.owner_notifications
FOR INSERT
TO authenticated
WITH CHECK (
  is_super_admin()
  OR is_tenant_member(tenant_id)
  OR (user_id = auth.uid())
);