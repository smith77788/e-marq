-- Add geo_targets to tenant_configs (brand-level default region)
ALTER TABLE public.tenant_configs
  ADD COLUMN IF NOT EXISTS geo_targets jsonb NOT NULL DEFAULT '{"country":"UA","cities":[],"whole_country":true}'::jsonb;

-- Add geo_targets override to agent_permissions (NULL = inherit from brand)
ALTER TABLE public.agent_permissions
  ADD COLUMN IF NOT EXISTS geo_targets jsonb;

COMMENT ON COLUMN public.tenant_configs.geo_targets IS
  'Default region for pricing/promo agents. Shape: {country: ISO-3166-1, cities: [{ref?, name}], whole_country: bool}';
COMMENT ON COLUMN public.agent_permissions.geo_targets IS
  'Per-agent region override. NULL = inherit tenant_configs.geo_targets. Same shape.';