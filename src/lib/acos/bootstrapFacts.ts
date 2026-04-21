/**
 * Helper для bootstrap-агентів: upsert у public.bootstrap_facts.
 *
 * Bootstrap-агенти (brand-profile, catalog-enricher, margin-estimator,
 * customer-voice, channel-discovery, seasonality-detector, integration-scout,
 * data-gap-auditor) пишуть сюди структуровані факти про бізнес.
 *
 * Усі робочі агенти (65+) можуть читати ці факти як ground truth замість
 * грубих припущень про маржу/тон/сезонність.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type BootstrapFactInput = {
  tenant_id: string;
  fact_kind: string;
  fact_key?: string;
  value: Record<string, unknown>;
  source?: "agent" | "owner" | "imported";
  confidence?: number;
  evidence?: Record<string, unknown>;
  /** ISO timestamp; null/undefined = no expiry */
  expires_at?: string | null;
};

export async function upsertBootstrapFacts(facts: BootstrapFactInput[]): Promise<number> {
  if (facts.length === 0) return 0;
  const rows = facts.map((f) => ({
    tenant_id: f.tenant_id,
    fact_kind: f.fact_kind,
    fact_key: f.fact_key ?? "default",
    value: f.value as never,
    source: f.source ?? "agent",
    confidence: f.confidence ?? 0.7,
    evidence: (f.evidence ?? {}) as never,
    expires_at: f.expires_at ?? null,
  }));
  const { error, count } = await supabaseAdmin
    .from("bootstrap_facts")
    .upsert(rows, { onConflict: "tenant_id,fact_kind,fact_key", count: "exact" });
  if (error) throw error;
  return count ?? rows.length;
}

export async function readBootstrapFact<T = Record<string, unknown>>(
  tenantId: string,
  factKind: string,
  factKey = "default",
): Promise<T | null> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", factKind)
    .eq("fact_key", factKey)
    .maybeSingle();
  return (data?.value as T) ?? null;
}

export async function readBootstrapFactsByKind<T = Record<string, unknown>>(
  tenantId: string,
  factKind: string,
): Promise<Array<{ key: string; value: T; confidence: number }>> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("fact_key, value, confidence")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", factKind);
  return (data ?? []).map((r) => ({
    key: r.fact_key,
    value: r.value as T,
    confidence: Number(r.confidence),
  }));
}
