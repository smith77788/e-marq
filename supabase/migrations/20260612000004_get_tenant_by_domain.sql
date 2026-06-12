-- ============================================================================
-- Custom-domain routing foundation: resolve a tenant by its custom domain
-- ============================================================================
-- tenant_domains stores verified custom domains with an is_primary flag, but no
-- RPC ever queried it by hostname, so verified domains were unreachable (the
-- storefront only resolves by /s/$slug). This adds the lookup the future
-- host-based routing layer needs. Read-only, anon-safe (returns no secrets):
-- only tenant_id, slug, and the matched domain.
--
-- Prefers the primary domain, then the most recently verified, so the bare
-- custom domain maps deterministically to one storefront.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tenant_domains_domain_active
  ON public.tenant_domains (lower(domain))
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.get_tenant_by_domain(_domain text)
RETURNS TABLE(tenant_id uuid, slug text, domain text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT td.tenant_id, t.slug, td.domain
  FROM public.tenant_domains td
  JOIN public.tenants t ON t.id = td.tenant_id
  WHERE lower(td.domain) = lower(trim(COALESCE(_domain, '')))
    AND td.status = 'active'
    AND t.status = 'active'
  ORDER BY td.is_primary DESC NULLS LAST, td.verified_at DESC NULLS LAST
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_by_domain(text) TO anon, authenticated;
