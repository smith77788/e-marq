CREATE POLICY "ai_memory_update_tenant_admin"
ON public.ai_memory
FOR UPDATE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));