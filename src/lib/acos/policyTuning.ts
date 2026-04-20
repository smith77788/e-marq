/**
 * Self-tuning helpers built on top of `decision_policies`.
 *
 * Engines call `getCadenceMultiplier(tenantId, kind)` before deciding when
 * to contact a customer. The multiplier nudges the recency window:
 *   - high win rate (>20%)    → 0.7  (contact more often)
 *   - low win rate (<5%, >30 trials) → 1.5  (back off)
 *   - otherwise               → 1.0
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function getCadenceMultiplier(
  tenantId: string,
  triggerKind: "reorder" | "winback" | "abandoned_cart",
): Promise<number> {
  const { data } = await supabaseAdmin
    .from("decision_policies")
    .select("trial_count, win_count")
    .eq("tenant_id", tenantId)
    .eq("policy_key", `engine.${triggerKind}.performance`)
    .eq("is_active", true)
    .maybeSingle();
  if (!data || data.trial_count < 10) return 1.0;
  const winRate = data.win_count / Math.max(data.trial_count, 1);
  if (winRate > 0.2) return 0.7;
  if (winRate < 0.05 && data.trial_count > 30) return 1.5;
  return 1.0;
}
