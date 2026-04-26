
CREATE TABLE IF NOT EXISTS public.telegram_owner_pairings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pairing_code TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  consumed_at TIMESTAMPTZ,
  consumed_chat_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_owner_pairings_tenant_idx
  ON public.telegram_owner_pairings (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS telegram_owner_pairings_code_idx
  ON public.telegram_owner_pairings (pairing_code) WHERE consumed_at IS NULL;

ALTER TABLE public.telegram_owner_pairings ENABLE ROW LEVEL SECURITY;

-- Tenant admins can manage pairing codes for their own tenant.
CREATE POLICY "tenant_admins_select_own_pairings"
  ON public.telegram_owner_pairings FOR SELECT
  TO authenticated
  USING (public.is_tenant_admin(tenant_id));

CREATE POLICY "tenant_admins_insert_own_pairings"
  ON public.telegram_owner_pairings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id) AND created_by = auth.uid());

CREATE POLICY "tenant_admins_delete_own_pairings"
  ON public.telegram_owner_pairings FOR DELETE
  TO authenticated
  USING (public.is_tenant_admin(tenant_id));
