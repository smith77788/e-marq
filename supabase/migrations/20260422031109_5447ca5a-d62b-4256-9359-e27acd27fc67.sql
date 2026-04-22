-- Sprint 12: Brand API keys for shared MARQ engine

CREATE TABLE IF NOT EXISTS public.tenant_api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- 8-char visible prefix for UX ("marq_pk_a1b2c3d4...") + sha256 hash of full key
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  -- 'public_readonly' = browser snippet can read insights summaries
  -- 'public_write'    = browser snippet can record events (rate-limited)
  -- 'server_full'     = trusted backend can read/write anything for this tenant
  tier TEXT NOT NULL DEFAULT 'public_write' CHECK (tier IN ('public_readonly','public_write','server_full')),
  scopes TEXT[] NOT NULL DEFAULT ARRAY['events:write','insights:read']::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (key_prefix, key_hash)
);

CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON public.tenant_api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_lookup ON public.tenant_api_keys(key_prefix) WHERE is_active = TRUE AND revoked_at IS NULL;

ALTER TABLE public.tenant_api_keys ENABLE ROW LEVEL SECURITY;

-- Members can view their tenant's keys (without seeing the hash, but RLS is row-level not column-level — apps must NOT select hash for end users)
CREATE POLICY "Members can view their tenant API keys"
  ON public.tenant_api_keys FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Members can create API keys for their tenant"
  ON public.tenant_api_keys FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Members can update their tenant API keys"
  ON public.tenant_api_keys FOR UPDATE
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Members can revoke their tenant API keys"
  ON public.tenant_api_keys FOR DELETE
  USING (public.is_tenant_member(tenant_id));

-- updated_at trigger
DROP TRIGGER IF EXISTS update_tenant_api_keys_updated_at ON public.tenant_api_keys;
CREATE TRIGGER update_tenant_api_keys_updated_at
  BEFORE UPDATE ON public.tenant_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Validation RPC: server-side (service role) compares hash and returns tenant_id + tier + scopes
CREATE OR REPLACE FUNCTION public.validate_tenant_api_key(_prefix TEXT, _hash TEXT)
RETURNS TABLE (tenant_id UUID, tier TEXT, scopes TEXT[], key_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.tenant_id, k.tier, k.scopes, k.id
  FROM public.tenant_api_keys k
  WHERE k.key_prefix = _prefix
    AND k.key_hash = _hash
    AND k.is_active = TRUE
    AND k.revoked_at IS NULL
  LIMIT 1;
$$;

-- Touch last_used_at (called from edge after validation)
CREATE OR REPLACE FUNCTION public.touch_tenant_api_key(_key_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.tenant_api_keys SET last_used_at = now() WHERE id = _key_id;
$$;