/**
 * Server-only helper: завантажує effective GeoTargets для агента
 * (agent_permissions.geo_targets > tenant_configs.geo_targets > DEFAULT).
 *
 * Використовується в hooks/agents/* — імпорт supabaseAdmin ОК тут.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_GEO_TARGETS,
  resolveGeoTargets,
  type GeoTargets,
} from "@/lib/acos/geoTargets";

export async function loadEffectiveGeoTargets(
  tenantId: string,
  agentId: string,
): Promise<GeoTargets> {
  const [permRes, cfgRes] = await Promise.all([
    supabaseAdmin
      .from("agent_permissions")
      .select("geo_targets")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agentId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_configs")
      .select("geo_targets")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  const agentOverride = permRes.data?.geo_targets ?? null;
  const brandDefault = cfgRes.data?.geo_targets ?? null;
  return resolveGeoTargets(agentOverride, brandDefault) ?? DEFAULT_GEO_TARGETS;
}
